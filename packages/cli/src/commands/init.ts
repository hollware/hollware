import { hashPersonalToken, PERSONAL_TOKEN_TTL_DAYS, SCOPES } from '@hollware/core'
import { rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { parseFlags } from '../args.ts'
import { chooseTarget, describeDatabase, query, resolveDatabase, runFile } from '../d1.ts'
import { inDays, newId, newPersonalToken } from '../entropy.ts'
import { CliError, UsageError } from '../errors.ts'
import type { Io } from '../io.ts'
import { initScript, ownerQuery, parseOwnerName, parseSiteKey } from '../sql.ts'

export const INIT_USAGE = [
  'Usage: hollware init --site <key> [--local | --remote] [--owner-name <name>] [--database <name>]',
  '',
  "Creates a site, its owner and the owner's first personal token in the project's D1 database,",
  'in one step, and prints the token once. It does nothing when the database already has an owner.',
  'Run "hollware migrate" first: the database needs its tables.',
  '',
  'Options:',
  '  --site <key>         The site, by the key it has in hollware.config.ts (required)',
  '  --local              Use the local database (the default)',
  '  --remote             Use the database in Cloudflare',
  '  --owner-name <name>  The name of the owner',
  '  --database <name>    The D1 database, by name or binding (default: the binding "DB" of wrangler.jsonc)',
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

  const [owners = []] = await query(io.wrangler, database, target, ownerQuery())
  const [existing] = owners
  if (existing !== undefined) {
    const id = typeof existing.id === 'string' ? ` (${existing.id})` : ''
    throw new CliError(
      `the database already has an owner${id}, so there is nothing to set up. Create another token with "hollware token create --label <text>".`,
    )
  }

  const now = io.now()
  const timestamp = now.toISOString()
  const ownerId = newId(io, 'user')
  const tokenId = newId(io, 'token')
  const secret = newPersonalToken(io)
  const expiresAt = inDays(now, PERSONAL_TOKEN_TTL_DAYS)
  const script = initScript({
    site,
    ownerId,
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
      'Next:',
      '  Save the token in a file only you can read, then import content:',
      '    hollware import <directory> --url <your Hollware URL> --token-file <file>',
      '  An MCP client sends it as the header "Authorization: Bearer <token>" to <your Hollware URL>/mcp.',
      '  More tokens: hollware token create --label <text>',
    ].join('\n'),
  )
  return 0
}
