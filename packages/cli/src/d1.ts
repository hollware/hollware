import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import * as z from 'zod'
import { CliError, UsageError } from './errors.ts'
import { parseJsonc } from './jsonc.ts'
import { parseDatabase } from './sql.ts'
import { failureReason, type RunWrangler, type WranglerResult } from './wrangler.ts'

export type Target = 'local' | 'remote'

export function chooseTarget(flags: {
  local?: boolean | undefined
  remote?: boolean | undefined
}): Target {
  if (flags.local === true && flags.remote === true) {
    throw new UsageError('--local and --remote cannot be used together: choose one.')
  }
  return flags.remote === true ? 'remote' : 'local'
}

export function describeDatabase(target: Target, database: string): string {
  return `the ${target} database "${database}"`
}

export const DEFAULT_BINDING = 'DB'

const CONFIG_FILES = ['wrangler.jsonc', 'wrangler.json']

const WranglerConfig = z.looseObject({
  d1_databases: z.array(z.looseObject({ binding: z.string() })).optional(),
})

export function resolveDatabase(cwd: string, database: string | undefined): string {
  if (database !== undefined) return parseDatabase(database)
  const file = CONFIG_FILES.map((name) => join(cwd, name)).find((path) => existsSync(path))
  if (file === undefined) {
    const hint = existsSync(join(cwd, 'wrangler.toml')) ? ' (wrangler.toml is not read)' : ''
    throw new CliError(
      `there is no wrangler.jsonc in ${cwd}${hint}. Run hollware from the project directory, or name the D1 database with --database <name>.`,
    )
  }
  const bindings = readBindings(file)
  if (bindings.includes(DEFAULT_BINDING)) return DEFAULT_BINDING
  throw new CliError(
    bindings.length === 0
      ? `${file} has no D1 database. Add a D1 binding named "${DEFAULT_BINDING}" (the starter has one), or name the database with --database <name>.`
      : `${file} has no D1 binding named "${DEFAULT_BINDING}" (it has ${bindings.join(', ')}). Rename the binding, or choose one with --database <name or binding>.`,
  )
}

function readBindings(file: string): string[] {
  let text: string
  try {
    text = readFileSync(file, 'utf8')
  } catch (error) {
    throw new CliError(
      `could not read ${file}: ${error instanceof Error ? error.message : String(error)}`,
    )
  }
  let json: unknown
  try {
    json = parseJsonc(text)
  } catch (error) {
    throw new CliError(
      `${file} is not valid JSON with comments: ${error instanceof Error ? error.message : String(error)}`,
    )
  }
  const config = WranglerConfig.safeParse(json)
  if (!config.success) {
    const [issue] = config.error.issues
    throw new CliError(
      `${file} has an unexpected shape at "${issue?.path.join('.') ?? ''}": ${issue?.message ?? 'invalid'}`,
    )
  }
  return (config.data.d1_databases ?? []).map((entry) => entry.binding)
}

export type Row = Record<string, unknown>

const Answer = z.array(
  z.object({
    results: z.array(z.record(z.string(), z.unknown())),
    success: z.boolean(),
  }),
)

export async function query(
  wrangler: RunWrangler,
  database: string,
  target: Target,
  sql: string,
): Promise<Row[][]> {
  const result = await wrangler([
    'd1',
    'execute',
    database,
    `--${target}`,
    '--json',
    '--command',
    sql,
  ])
  return readAnswer(result, database, target)
}

export async function runFile(
  wrangler: RunWrangler,
  database: string,
  target: Target,
  file: string,
): Promise<void> {
  const result = await wrangler([
    'd1',
    'execute',
    database,
    `--${target}`,
    '--json',
    '--file',
    file,
  ])
  readAnswer(result, database, target)
}

function readAnswer(result: WranglerResult, database: string, target: Target): Row[][] {
  if (result.code !== 0) {
    const reason = failureReason(result)
    if (reason.includes('no such table')) {
      const flag = database === DEFAULT_BINDING ? '' : ` --database ${database}`
      throw new CliError(
        `the database has no Hollware tables yet. Run "hollware migrate --${target}${flag}" first.`,
      )
    }
    throw new CliError(`wrangler could not run the SQL: ${reason}`)
  }
  const json = jsonOf(result.stdout)
  if (json === undefined) {
    throw new CliError(`wrangler did not answer with JSON: ${failureReason(result)}`)
  }
  const answer = Answer.safeParse(json)
  if (!answer.success) {
    throw new CliError('wrangler answered with JSON that has an unexpected shape.')
  }
  if (answer.data.some((statement) => !statement.success)) {
    throw new CliError('wrangler reported that a statement did not succeed.')
  }
  return answer.data.map((statement) => statement.results)
}

function jsonOf(stdout: string): unknown {
  const attempts = [
    stdout,
    ...stdout
      .split('\n')
      .flatMap((line, index, lines) =>
        line.trimStart().startsWith('[') ? [lines.slice(index).join('\n')] : [],
      ),
  ]
  for (const text of attempts) {
    try {
      return JSON.parse(text)
    } catch {}
  }
  return undefined
}
