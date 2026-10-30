import { parseFlags } from '../args.ts'
import { chooseTarget, query, resolveDatabase, type Target } from '../d1.ts'
import { newId } from '../entropy.ts'
import { CliError, UsageError } from '../errors.ts'
import { printable, table } from '../format.ts'
import type { Io } from '../io.ts'
import {
  insertAgentMember,
  listAgentMembers,
  parseAgentName,
  parseSiteKey,
  parseUserId,
  removeAgentMember,
  sitesQuery,
} from '../sql.ts'
import { chooseSite, WHERE_OPTIONS } from './token.ts'

const WHERE_FLAGS = [
  '  --site <key>       The site (default: the only site of the database)',
  '  --local            Use the local database (the default)',
  '  --remote           Use the database in Cloudflare',
  '  --database <name>  The D1 database, by name or binding (default: the binding "DB" of wrangler.jsonc)',
  '  --help             Show this help',
]

export const AGENT_USAGE = [
  'Usage: hollware agent <command> [options]',
  '',
  'Commands:',
  '  add     Add an agent member to a site and print its id',
  '  list    List the agent members of a site',
  '  remove  Remove an agent member from a site and revoke its grants',
  '',
  'An agent member is the member an agent of the site definition acts as. Run',
  '"hollware agent <command> --help" for the options of a command.',
].join('\n')

export const AGENT_ADD_USAGE = [
  'Usage: hollware agent add <name> [--json]',
  '                             [--site <key>] [--local | --remote] [--database <name>]',
  '',
  'Adds an agent member to a site: an author that is no person, named <name> (lowercase letters',
  'and digits joined by hyphens, up to 64 characters). Prints its id, which the site definition',
  'declares as the member of the agent, under "agents".',
  '',
  'Options:',
  '  --json             One JSON object on stdout and nothing else: site, id, name',
  ...WHERE_FLAGS,
].join('\n')

export const AGENT_LIST_USAGE = [
  'Usage: hollware agent list [--json] [--site <key>] [--local | --remote] [--database <name>]',
  '',
  'Lists the agent members of a site: id, name and since when.',
  '',
  'Options:',
  '  --json             One JSON object on stdout and nothing else: site, agents (id, name, since)',
  ...WHERE_FLAGS,
].join('\n')

export const AGENT_REMOVE_USAGE = [
  'Usage: hollware agent remove <id> [--site <key>] [--local | --remote] [--database <name>]',
  '',
  'Removes an agent member from a site and revokes its live grants at once. A person is never',
  'removed. "hollware agent list" shows the ids.',
  '',
  'Options:',
  ...WHERE_FLAGS,
].join('\n')

export async function agent(argv: readonly string[], io: Io): Promise<number> {
  const [subcommand, ...rest] = argv
  switch (subcommand) {
    case undefined:
    case '--help':
      io.out(AGENT_USAGE)
      return 0
    case 'add':
      return addAgent(rest, io)
    case 'list':
      return listAgents(rest, io)
    case 'remove':
      return removeAgent(rest, io)
    default:
      throw new UsageError(`unknown command "${printable(subcommand)}": use add, list or remove.`)
  }
}

async function siteOf(
  site: string | undefined,
  io: Io,
  target: Target,
  database: string,
): Promise<string> {
  const [siteRows = []] = await query(io.wrangler, database, target, sitesQuery())
  return chooseSite(siteRows, site)
}

async function addAgent(argv: readonly string[], io: Io): Promise<number> {
  const { values, positionals } = parseFlags({
    args: [...argv],
    allowPositionals: true,
    options: { ...WHERE_OPTIONS, json: { type: 'boolean' } },
  })
  if (values.help === true) {
    io.out(AGENT_ADD_USAGE)
    return 0
  }
  const [rawName, ...extra] = positionals
  if (rawName === undefined || extra.length > 0) {
    throw new UsageError('add takes the name of one agent: hollware agent add <name>.')
  }
  const name = parseAgentName(rawName)
  const siteFlag = values.site === undefined ? undefined : parseSiteKey(values.site)
  const target = chooseTarget(values)
  const database = resolveDatabase(io.cwd, values.database)
  const site = await siteOf(siteFlag, io, target, database)

  const userId = newId(io, 'user')
  const [, added = []] = await query(
    io.wrangler,
    database,
    target,
    insertAgentMember({
      userId,
      memberId: newId(io, 'member'),
      site,
      name,
      now: io.now().toISOString(),
    }),
  )
  if (added.length === 0) {
    throw new CliError(
      `the site "${site}" already has an agent named "${name}". "hollware agent list" shows its id.`,
    )
  }
  if (values.json === true) {
    io.out(JSON.stringify({ site, id: userId, name }))
    return 0
  }
  io.out(
    [
      `Added the agent "${name}" to the site "${site}": ${userId}`,
      '',
      `Declare it in the "agents" of the site definition, with "member": "${userId}", on the`,
      'Agents page of the admin or with update_site.',
    ].join('\n'),
  )
  return 0
}

async function listAgents(argv: readonly string[], io: Io): Promise<number> {
  const { values } = parseFlags({
    args: [...argv],
    allowPositionals: false,
    options: { ...WHERE_OPTIONS, json: { type: 'boolean' } },
  })
  if (values.help === true) {
    io.out(AGENT_LIST_USAGE)
    return 0
  }
  const siteFlag = values.site === undefined ? undefined : parseSiteKey(values.site)
  const target = chooseTarget(values)
  const database = resolveDatabase(io.cwd, values.database)
  const site = await siteOf(siteFlag, io, target, database)

  const [rows = []] = await query(io.wrangler, database, target, listAgentMembers(site))
  const agents = rows.map((row) => ({
    id: text(row['id']),
    name: text(row['name']),
    since: text(row['since']),
  }))
  if (values.json === true) {
    io.out(JSON.stringify({ site, agents }))
    return 0
  }
  io.out(
    agents.length === 0
      ? `The site "${site}" has no agent members.`
      : table(
          ['ID', 'NAME', 'SINCE'],
          agents.map((member) => [member.id, member.name, member.since]),
        ),
  )
  return 0
}

async function removeAgent(argv: readonly string[], io: Io): Promise<number> {
  const { values, positionals } = parseFlags({
    args: [...argv],
    allowPositionals: true,
    options: WHERE_OPTIONS,
  })
  if (values.help === true) {
    io.out(AGENT_REMOVE_USAGE)
    return 0
  }
  const [rawId, ...extra] = positionals
  if (rawId === undefined || extra.length > 0) {
    throw new UsageError('remove takes the id of one agent: hollware agent remove <id>.')
  }
  const id = parseUserId(rawId)
  const siteFlag = values.site === undefined ? undefined : parseSiteKey(values.site)
  const target = chooseTarget(values)
  const database = resolveDatabase(io.cwd, values.database)
  const site = await siteOf(siteFlag, io, target, database)

  const [, removed = []] = await query(
    io.wrangler,
    database,
    target,
    removeAgentMember(id, site, io.now().toISOString()),
  )
  if (removed.length === 0) {
    throw new CliError(
      `${id} is no agent member of the site "${site}". "hollware agent list" shows the ones that are.`,
    )
  }
  io.out(
    `Removed the agent ${id} from the site "${site}" and revoked its grants. Take it out of the "agents" of the site definition too.`,
  )
  return 0
}

function text(value: unknown): string {
  return typeof value === 'string' ? printable(value) : ''
}
