import { existsSync, mkdirSync, statSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { parseFlags } from '../args.ts'
import { chooseTarget, describeDatabase, resolveDatabase } from '../d1.ts'
import { CliError } from '../errors.ts'
import type { Io } from '../io.ts'
import { failureReason, stripAnsi } from '../wrangler.ts'

export const MIGRATE_USAGE = [
  'Usage: hollware migrate [--local | --remote] [--check] [--database <name>]',
  '',
  'Applies the D1 migrations the project has not applied yet, with wrangler. Before it applies',
  'anything to the remote database it exports a backup, and it stops if the backup fails. D1',
  'cannot export a database with a full-text index (0.5 and later): it takes a Time Travel',
  'bookmark instead, which restores the database as it was. The export can make the database',
  'unavailable for a moment; with nothing pending, or on a new database that has none of the',
  'migrations yet, there is no backup.',
  '',
  'Options:',
  '  --local            Use the local database (the default)',
  '  --remote           Use the database in Cloudflare, after a backup in .wrangler/hollware-backups',
  '  --check            Only list the pending migrations; exit with code 1 when there are some',
  '  --database <name>  The D1 database, by name or binding (default: the binding "DB" of wrangler.jsonc)',
  '  --help             Show this help',
].join('\n')

export const FIRST_MIGRATION = '0000_init.sql'

export const BACKUP_DIRECTORY = join('.wrangler', 'hollware-backups')

export async function migrate(argv: readonly string[], io: Io): Promise<number> {
  const { values } = parseFlags({
    args: [...argv],
    allowPositionals: false,
    options: {
      local: { type: 'boolean' },
      remote: { type: 'boolean' },
      check: { type: 'boolean' },
      database: { type: 'string' },
      help: { type: 'boolean' },
    },
  })
  if (values.help === true) {
    io.out(MIGRATE_USAGE)
    return 0
  }
  const target = chooseTarget(values)
  const database = resolveDatabase(io.cwd, values.database)
  const where = describeDatabase(target, database)

  const listed = await io.wrangler(['d1', 'migrations', 'list', database, `--${target}`])
  if (listed.code !== 0) {
    throw new CliError(`wrangler could not list the migrations: ${failureReason(listed)}`)
  }
  const pending = parsePendingMigrations(listed.stdout)
  if (pending.length === 0) {
    io.out(`No pending migrations on ${where}.`)
    return 0
  }
  const count = `${pending.length} ${pending.length === 1 ? 'migration' : 'migrations'}`
  if (values.check === true) {
    io.out([`${count} pending on ${where}:`, ...pending.map((name) => `  ${name}`)].join('\n'))
    throw new CliError(`${count} pending. Run "hollware migrate --${target}" to apply them.`)
  }

  const fresh = pending.includes(FIRST_MIGRATION)
  const backup = target === 'remote' && !fresh ? await takeBackup(io, database) : undefined
  const applied = await io.wrangler(['d1', 'migrations', 'apply', database, `--${target}`])
  if (applied.code !== 0) {
    const saved = backup === undefined ? '' : ` The backup taken before is in ${backup}.`
    throw new CliError(
      `wrangler stopped while applying the migrations: ${failureReason(applied)}. The migrations before the failing one stay applied; "hollware migrate --check" shows what is left.${saved}`,
    )
  }
  io.out(
    [
      `Applied ${count} to ${where}:`,
      ...pending.map((name) => `  ${name}`),
      ...(backup === undefined ? [] : [`Backup taken before: ${backup}`]),
    ].join('\n'),
  )
  return 0
}

export function parsePendingMigrations(stdout: string): string[] {
  const text = stripAnsi(stdout)
  if (text.includes('No migrations to apply!')) return []
  const marker = text.indexOf('Migrations to be applied:')
  if (marker !== -1) {
    const rows = text
      .slice(marker)
      .split('\n')
      .map((line) => /^[│|]\s*(.+?)\s*[│|]$/.exec(line.trim())?.[1])
      .filter((cell): cell is string => cell !== undefined)
    const names = rows.slice(1)
    if (names.length > 0) return names
  }
  throw new CliError(
    'could not read the answer of "wrangler d1 migrations list": it neither says that there is nothing to apply nor lists the pending migrations. Is the wrangler of this project a version hollware does not know?',
  )
}

async function takeBackup(io: Io, database: string): Promise<string> {
  const where = describeDatabase('remote', database)
  const file = join(io.cwd, BACKUP_DIRECTORY, `${database}-${timestamp(io.now())}.sql`)
  mkdirSync(dirname(file), { recursive: true })
  io.out(`Backing up ${where} to ${file} ...`)
  const exported = await io.wrangler([
    'd1',
    'export',
    database,
    '--remote',
    '--output',
    file,
    '--skip-confirmation',
  ])
  if (exported.code !== 0) {
    const reason = failureReason(exported)
    if (/virtual tables?/i.test(reason)) return takeBookmark(io, database)
    throw new CliError(`the backup of ${where} failed, so no migration was applied: ${reason}`)
  }
  if (!existsSync(file) || statSync(file).size === 0) {
    throw new CliError(
      `wrangler reported success but wrote no backup to ${file}, so no migration was applied. Check "wrangler d1 export ${database} --remote --output <file>" by hand.`,
    )
  }
  return file
}

async function takeBookmark(io: Io, database: string): Promise<string> {
  const where = describeDatabase('remote', database)
  io.out(
    `D1 cannot export ${where}, which has a full-text index; taking a Time Travel bookmark instead ...`,
  )
  const info = await io.wrangler(['d1', 'time-travel', 'info', database, '--json'])
  let bookmark: unknown = null
  try {
    const parsed: unknown = JSON.parse(stripAnsi(info.stdout))
    bookmark =
      typeof parsed === 'object' && parsed !== null && 'bookmark' in parsed ? parsed.bookmark : null
  } catch {
    bookmark = null
  }
  if (info.code !== 0 || typeof bookmark !== 'string' || bookmark === '') {
    throw new CliError(
      `no Time Travel bookmark of ${where} could be taken, so no migration was applied: ${info.code === 0 ? 'wrangler answered no bookmark' : failureReason(info)}`,
    )
  }
  return `the Time Travel bookmark ${bookmark}; restore it with "npx wrangler d1 time-travel restore ${database} --bookmark=${bookmark}"`
}

function timestamp(date: Date): string {
  return date
    .toISOString()
    .replace(/[-:]/g, '')
    .replace(/\.\d{3}Z$/, 'Z')
}
