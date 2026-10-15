import { hashPersonalToken, PERSONAL_TOKEN_TTL_DAYS, SCOPES } from '@hollware/core'
import { rmSync, writeFileSync } from 'node:fs'
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
  'Usage: hollware init --site <key> [--local | --remote] [--owner-name <name>] [--database <name>] [--url <url>]',
  '',
  "Creates a site, its owner and the owner's first personal token in the project's D1 database,",
  'in one step, and prints the token once, with a link to set up the passkey of the admin (valid',
  'for 7 days). On a database that has an owner already, it adds the site to that owner, who signs',
  'in to the admin as before, and prints a token of the new site. It does nothing when the site',
  'has an owner.',
  'Run "hollware migrate" first: the database needs its tables.',
  '',
  'Options:',
  '  --site <key>         The site, by the key it has in hollware.config.ts (required)',
  '  --local              Use the local database (the default)',
  '  --remote             Use the database in Cloudflare',
  '  --owner-name <name>  The name of the owner',
  '  --database <name>    The D1 database, by name or binding (default: the binding "DB" of wrangler.jsonc)',
  '  --url <url>          The public URL of Hollware, for the link (default: HOLLWARE_PUBLIC_URL of wrangler.jsonc)',
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
      database: { type: 'string' },
      url: { type: 'string' },
      help: { type: 'boolean' },
    },
  })
  if (values.help === true) {
    io.out(INIT_USAGE)
    return 0
  }
  if (values.site === undefined) {
    throw new UsageError('--site is required: name the site, as in hollware.config.ts.')
  }
  const site = parseSiteKey(values.site)
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
    return await addSite(io, { site, ownerId: first['id'], database, target })
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
    ].join('\n'),
  )
  return 0
}

/** `init` for one more site of a deployment whose owner exists: that owner owns the new site too. */
async function addSite(
  io: Io,
  where: { site: string; ownerId: string; database: string; target: Target },
): Promise<number> {
  const { site, ownerId, database, target } = where
  const now = io.now()
  const timestamp = now.toISOString()
  const tokenId = newId(io, 'token')
  const secret = newPersonalToken(io)
  const expiresAt = inDays(now, PERSONAL_TOKEN_TTL_DAYS)
  const script = anotherSiteScript({
    site,
    ownerId,
    memberId: newId(io, 'member'),
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
    ].join('\n'),
  )
  return 0
}
