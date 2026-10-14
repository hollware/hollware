import { hashPersonalToken } from '@hollware/core'
import { parseFlags } from '../args.ts'
import { chooseTarget, query, resolveDatabase } from '../d1.ts'
import { inDays, INVITATION_TTL_DAYS, newId, newInvitationSecret } from '../entropy.ts'
import { UsageError } from '../errors.ts'
import type { Io } from '../io.ts'
import { publicUrlOf, setupLink } from '../public-url.ts'
import { insertInvitation, parseExpiresInDays, parseSiteKey, sitesQuery } from '../sql.ts'
import { chooseSite, WHERE_OPTIONS } from './token.ts'

export const INVITE_USAGE = [
  'Usage: hollware invite --role <editor | author> [--days <n>] [--url <url>]',
  '                       [--site <key>] [--local | --remote] [--database <name>]',
  '',
  'Invites a person to the admin (ADR-026): prints a link, valid once and for 7 days by default,',
  'where they set up a passkey. An editor reads, writes and publishes; an author reads and writes,',
  'and what an author publishes goes through review.',
  '',
  'Options:',
  '  --role <role>      editor or author (required)',
  '  --days <n>         Days until the link expires, 1 to 365 (default: 7)',
  '  --url <url>        The public URL of Hollware (default: HOLLWARE_PUBLIC_URL of wrangler.jsonc)',
  '  --site <key>       The site (default: the only site of the database)',
  '  --local            Use the local database (the default)',
  '  --remote           Use the database in Cloudflare',
  '  --database <name>  The D1 database, by name or binding (default: the binding "DB" of wrangler.jsonc)',
  '  --help             Show this help',
].join('\n')

export async function invite(argv: readonly string[], io: Io): Promise<number> {
  const { values } = parseFlags({
    args: [...argv],
    allowPositionals: false,
    options: {
      ...WHERE_OPTIONS,
      role: { type: 'string' },
      days: { type: 'string' },
      url: { type: 'string' },
    },
  })
  if (values.help === true) {
    io.out(INVITE_USAGE)
    return 0
  }
  const role = values.role
  if (role !== 'editor' && role !== 'author') {
    throw new UsageError('--role is required, and it is editor or author.')
  }
  const days = values.days === undefined ? INVITATION_TTL_DAYS : parseExpiresInDays(values.days)
  const siteFlag = values.site === undefined ? undefined : parseSiteKey(values.site)
  const target = chooseTarget(values)
  const database = resolveDatabase(io.cwd, values.database)
  const url = publicUrlOf(io.cwd, values.url)

  const [siteRows = []] = await query(io.wrangler, database, target, sitesQuery())
  const site = chooseSite(siteRows, siteFlag)
  const now = io.now()
  const secret = newInvitationSecret(io)
  const expiresAt = inDays(now, days)
  await query(
    io.wrangler,
    database,
    target,
    insertInvitation({
      id: newId(io, 'invitation'),
      site,
      hash: await hashPersonalToken(secret),
      role,
      userId: null,
      expiresAt,
      now: now.toISOString(),
    }),
  )
  io.out(
    [
      `Invited an ${role} to the site "${site}". The link works once, until ${expiresAt}:`,
      '',
      `  ${setupLink(url, secret)}`,
    ].join('\n'),
  )
  return 0
}
