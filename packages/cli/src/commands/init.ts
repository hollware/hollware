import {
  AUDIT_RETENTION_MAX_DAYS,
  AUDIT_RETENTION_MIN_DAYS,
  hashPersonalToken,
  PERSONAL_TOKEN_TTL_DAYS,
  PRESETS,
  SCOPES,
  sitePreset,
  type Preset,
} from '@hollware/core'
import { existsSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { parseFlags } from '../args.ts'
import {
  chooseTarget,
  describeDatabase,
  query,
  resolveDatabase,
  runFile,
  type Target,
} from '../d1.ts'
import {
  inDays,
  INVITATION_TTL_DAYS,
  newId,
  newInvitationSecret,
  newPersonalToken,
} from '../entropy.ts'
import { CliError, UsageError } from '../errors.ts'
import type { Io } from '../io.ts'
import { publicUrlOf, setupLink } from '../public-url.ts'
import {
  anotherSiteScript,
  initScript,
  insertInvitation,
  ownerQuery,
  parseOwnerName,
  parseSiteKey,
} from '../sql.ts'

export const INIT_USAGE = [
  'Usage: hollware init --site <key> [--preset <blog | docs | empty>] [--locales <list>]',
  '                     [--local | --remote] [--owner-name <name>] [--database <name>] [--url <url>]',
  '                     [--ip-addresses <off | hashed>] [--audit-retention-days <n>]',
  '',
  "Creates a site, its owner and the owner's first personal token in the project's D1 database,",
  'in one step, and prints the token once, with a link to set up the passkey of the admin (valid',
  'for 7 days). On a database that has an owner already, it adds the site to that owner, who signs',
  'in to the admin as before, and prints a token of the new site. It does nothing when the site',
  'has an owner.',
  'The site starts from a preset, which its owner then shapes in the admin, or an agent over MCP',
  '(ADR-033). A project with a hollware.config.ts keeps it instead: the Worker moves it into the',
  'database on its first request.',
  'Run "hollware migrate" first: the database needs its tables.',
  '',
  'Options:',
  '  --site <key>         The key of the site, such as my-site; it never changes (required)',
  '  --preset <preset>    blog, docs or empty: a title alone (default: blog)',
  '  --locales <list>     The locales, comma-separated, the first the default (default: en)',
  '  --local              Use the local database (the default)',
  '  --remote             Use the database in Cloudflare',
  '  --owner-name <name>  The name of the owner',
  '  --database <name>    The D1 database, by name or binding (default: the binding "DB" of wrangler.jsonc)',
  '  --url <url>          The public URL of Hollware, for the link (default: HOLLWARE_PUBLIC_URL of wrangler.jsonc)',
  '  --ip-addresses <off | hashed>',
  '                       Whether the activity log keeps a keyed hash of the address of each request',
  '                       (default: off, nothing of it): an address is personal data',
  '  --audit-retention-days <n>',
  '                       The days each line of the activity log is kept, 30 to 3650 (default: forever)',
  '  --help               Show this help',
].join('\n')

/** The label of the token `init` creates. */
export const FIRST_TOKEN_LABEL = 'hollware init'

export async function init(argv: readonly string[], io: Io): Promise<number> {
  const { values } = parseFlags({
    args: [...argv],
    allowPositionals: false,
    options: {
      site: { type: 'string' },
      local: { type: 'boolean' },
      remote: { type: 'boolean' },
      'owner-name': { type: 'string' },
      preset: { type: 'string' },
      locales: { type: 'string' },
      database: { type: 'string' },
      url: { type: 'string' },
      'ip-addresses': { type: 'string' },
      'audit-retention-days': { type: 'string' },
      help: { type: 'boolean' },
    },
  })
  if (values.help === true) {
    io.out(INIT_USAGE)
    return 0
  }
  if (values.site === undefined) {
    throw new UsageError('--site is required: name the site, such as --site my-site.')
  }
  const site = parseSiteKey(values.site)
  const audit = auditOf(values['ip-addresses'], values['audit-retention-days'])
  const definition = initialDefinition(io.cwd, values.preset, values.locales, audit)
  const ownerName =
    values['owner-name'] === undefined ? undefined : parseOwnerName(values['owner-name'])
  const target = chooseTarget(values)
  const database = resolveDatabase(io.cwd, values.database)
  const url = publicUrlOf(io.cwd, values.url)

  const [owners = []] = await query(io.wrangler, database, target, ownerQuery())
  const ofSite = owners.find((owner) => owner['site'] === site)
  if (ofSite !== undefined) {
    const id = typeof ofSite['id'] === 'string' ? ` (${ofSite['id']})` : ''
    throw new CliError(
      `the site "${site}" already has an owner${id}, so there is nothing to set up. Create another token with "hollware token create --site ${site} --label <text>".`,
    )
  }
  const [first] = owners
  if (first !== undefined && typeof first['id'] === 'string') {
    return await addSite(io, {
      site,
      ownerId: first['id'],
      database,
      target,
      definition,
      audit,
    })
  }

  const now = io.now()
  const timestamp = now.toISOString()
  const ownerId = newId(io, 'user')
  const tokenId = newId(io, 'token')
  const secret = newPersonalToken(io)
  const expiresAt = inDays(now, PERSONAL_TOKEN_TTL_DAYS)
  const setupSecret = newInvitationSecret(io)
  const setupExpiresAt = inDays(now, INVITATION_TTL_DAYS)
  const setup = insertInvitation({
    id: newId(io, 'invitation'),
    site,
    hash: await hashPersonalToken(setupSecret),
    role: 'owner',
    userId: ownerId,
    expiresAt: setupExpiresAt,
    now: timestamp,
  })
  // Drawn last, so that the ids and secrets above stay what they were before members existed.
  const memberId = newId(io, 'member')
  // And the change of the structure after it, for the same reason.
  const structure =
    definition === null ? undefined : { definition, changeId: newId(io, 'siteChange') }
  const script = initScript({
    site,
    ownerId,
    memberId,
    ownerName,
    token: {
      id: tokenId,
      site,
      userId: ownerId,
      label: FIRST_TOKEN_LABEL,
      hash: await hashPersonalToken(secret),
      scopes: SCOPES,
      expiresAt,
      now: timestamp,
    },
    structure,
  }).concat(`${setup}\n`)

  const directory = io.tempDir()
  try {
    const file = join(directory, 'init.sql')
    writeFileSync(file, script, { mode: 0o600 })
    await runFile(io.wrangler, database, target, file)
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }

  io.out(
    [
      `Hollware is ready on ${describeDatabase(target, database)}.`,
      '',
      `Site     ${site}`,
      `Owner    ${ownerId}`,
      `Token    ${tokenId}`,
      `Scopes   ${SCOPES.join(' ')}`,
      `Expires  ${expiresAt} (in ${PERSONAL_TOKEN_TTL_DAYS} days)`,
      '',
      'Your personal token. It is shown only once: Hollware keeps just its hash.',
      '',
      secret,
      '',
      `Set up your passkey for the admin, once, by ${setupExpiresAt}:`,
      `  ${setupLink(url, setupSecret)}`,
      '',
      'Next:',
      '  Save the token in a file only you can read, then import content:',
      '    hollware import <directory> --url <your Hollware URL> --token-file <file>',
      '  An MCP client sends it as the header "Authorization: Bearer <token>" to <your Hollware URL>/mcp.',
      '  More tokens: hollware token create --label <text>',
      ...(definition === null ? [] : ['', activityNote(audit)]),
    ].join('\n'),
  )
  return 0
}

/** `init` for one more site of a deployment whose owner exists: that owner owns the new site too. */
async function addSite(
  io: Io,
  where: {
    site: string
    ownerId: string
    database: string
    target: Target
    definition: unknown
    audit: AuditChoice
  },
): Promise<number> {
  const { site, ownerId, database, target, definition } = where
  const now = io.now()
  const timestamp = now.toISOString()
  const tokenId = newId(io, 'token')
  const secret = newPersonalToken(io)
  const expiresAt = inDays(now, PERSONAL_TOKEN_TTL_DAYS)
  const memberId = newId(io, 'member')
  const structure =
    definition === null ? undefined : { definition, changeId: newId(io, 'siteChange') }
  const script = anotherSiteScript({
    site,
    ownerId,
    memberId,
    structure,
    token: {
      id: tokenId,
      site,
      userId: ownerId,
      label: FIRST_TOKEN_LABEL,
      hash: await hashPersonalToken(secret),
      scopes: SCOPES,
      expiresAt,
      now: timestamp,
    },
  })
  const directory = io.tempDir()
  try {
    const file = join(directory, 'init.sql')
    writeFileSync(file, script, { mode: 0o600 })
    await runFile(io.wrangler, database, target, file)
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
  io.out(
    [
      `Added the site "${site}" on ${describeDatabase(target, database)}, owned by the owner of the database.`,
      '',
      `Site     ${site}`,
      `Owner    ${ownerId}`,
      `Token    ${tokenId}`,
      `Scopes   ${SCOPES.join(' ')}`,
      `Expires  ${expiresAt} (in ${PERSONAL_TOKEN_TTL_DAYS} days)`,
      '',
      'A personal token of the new site. It is shown only once: Hollware keeps just its hash.',
      '',
      secret,
      '',
      'The owner signs in to the admin as before, with the same passkey, and switches to the site.',
      ...(definition === null ? [] : ['', activityNote(where.audit)]),
    ].join('\n'),
  )
  return 0
}

/** A locale tag, as a site's definition takes it: `en`, `es-CL`. */
const LOCALE = /^[a-z]{2,3}(?:-[A-Za-z0-9]{2,8})*$/

/**
 * The first definition of the site (ADR-033), from `--preset` and `--locales`; `null` for a
 * project with a hollware.config.ts, whose Worker moves it into the database on its first request.
 */
export function initialDefinition(
  cwd: string,
  preset: string | undefined,
  locales: string | undefined,
  audit: AuditChoice = DEFAULT_AUDIT_CHOICE,
): unknown {
  if (existsSync(join(cwd, 'hollware.config.ts'))) {
    if (preset !== undefined || locales !== undefined || audit.given) {
      throw new UsageError(
        'this project has a hollware.config.ts, which the Worker moves into the database: leave out --preset, --locales, --ip-addresses and --audit-retention-days, or delete the config first.',
      )
    }
    return null
  }
  const chosen = preset ?? 'blog'
  if (!PRESETS.some((name) => name === chosen)) {
    throw new UsageError(`--preset is one of ${PRESETS.join(', ')}, not "${chosen}".`)
  }
  const list = (locales ?? 'en')
    .split(',')
    .map((locale) => locale.trim())
    .filter((locale) => locale !== '')
  const bad = list.find((locale) => !LOCALE.test(locale))
  if (list.length === 0 || bad !== undefined) {
    throw new UsageError(
      `--locales is a comma-separated list of locales, such as en,es; "${bad ?? ''}" is not one.`,
    )
  }
  return {
    ...sitePreset(chosen as Preset, list, list[0] ?? 'en'),
    audit: { ipAddresses: audit.ipAddresses, retentionDays: audit.retentionDays },
  }
}

/** What the activity log of the new site keeps (ADR-037), and whether a flag said so. */
export interface AuditChoice {
  readonly ipAddresses: 'off' | 'hashed'
  readonly retentionDays: number | null
  readonly given: boolean
}

const DEFAULT_AUDIT_CHOICE: AuditChoice = { ipAddresses: 'off', retentionDays: null, given: false }

/** `--ip-addresses` and `--audit-retention-days`, checked; the defaults when both are left out. */
export function auditOf(addresses: string | undefined, days: string | undefined): AuditChoice {
  if (addresses !== undefined && addresses !== 'off' && addresses !== 'hashed') {
    throw new UsageError(`--ip-addresses is off or hashed, not "${addresses}".`)
  }
  let retentionDays: number | null = null
  if (days !== undefined) {
    retentionDays = /^\d+$/.test(days) ? Number(days) : Number.NaN
    if (
      !Number.isInteger(retentionDays) ||
      retentionDays < AUDIT_RETENTION_MIN_DAYS ||
      retentionDays > AUDIT_RETENTION_MAX_DAYS
    ) {
      throw new UsageError(
        `--audit-retention-days is a whole number from ${AUDIT_RETENTION_MIN_DAYS} to ${AUDIT_RETENTION_MAX_DAYS}, not "${days}". Leave it out to keep every line.`,
      )
    }
  }
  return {
    ipAddresses: addresses === 'hashed' ? 'hashed' : 'off',
    retentionDays,
    given: addresses !== undefined || days !== undefined,
  }
}

/** What `init` says of the activity log of the new site, and where its owner changes it. */
export function activityNote(audit: AuditChoice): string {
  const addresses =
    audit.ipAddresses === 'hashed'
      ? 'keeps a keyed hash of the address of each request'
      : 'keeps no address'
  const kept =
    audit.retentionDays === null
      ? 'keeps every line'
      : `keeps each line ${audit.retentionDays} days`
  return `The activity log of the site ${addresses} and ${kept}; an owner changes that in the admin (Site, Activity log).`
}
