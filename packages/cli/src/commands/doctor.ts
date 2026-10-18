import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { parseFlags } from '../args.ts'
import { chooseTarget, DEFAULT_BINDING, query, type Target } from '../d1.ts'
import { CliError } from '../errors.ts'
import type { Io } from '../io.ts'
import { parseJsonc } from '../jsonc.ts'
import { ownerQuery } from '../sql.ts'
import { failureReason } from '../wrangler.ts'
import { parsePendingMigrations } from './migrate.ts'

export const DOCTOR_USAGE = [
  'Usage: hollware doctor [--local | --remote] [--json]',
  '',
  'Checks the project in the current directory: its wrangler.jsonc, the bindings and flags',
  'Hollware needs, the built files of the admin, the migrations of the database and its owner.',
  'Each problem comes with what to do about it. Exits with code 1 when something is wrong.',
  '',
  'Options:',
  '  --local   Check the local database (the default)',
  '  --remote  Check the database in Cloudflare',
  '  --json    One JSON object on stdout: { ok, checks: [{ name, ok, message, fix }] }; the exit code',
  '            is the same (fix is "" for a check that passed)',
  '  --help    Show this help',
].join('\n')

/** The flags of `compatibility_flags` that Hollware runs with (ADR-018, ADR-026). */
export const REQUIRED_FLAGS = [
  'no_nodejs_compat',
  'no_nodejs_compat_v2',
  'global_fetch_strictly_public',
] as const

/** One finding: what was checked, and what to do when it failed. */
export interface Finding {
  /** A stable name for scripts: it does not change with the wording of `what`. */
  readonly name: string
  readonly ok: boolean
  readonly what: string
  readonly fix?: string
}

const pass = (name: string, what: string): Finding => ({ name, ok: true, what })
const fail = (name: string, what: string, fix: string): Finding => ({ name, ok: false, what, fix })

type Json = Record<string, unknown>

function isRecord(value: unknown): value is Json {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function records(value: unknown): Json[] {
  return Array.isArray(value) ? value.filter(isRecord) : []
}

/** What `wrangler.jsonc` says, checked without reaching Cloudflare or the database. */
export function checkConfig(cwd: string, config: Json): Finding[] {
  const findings: Finding[] = []
  const flags = Array.isArray(config['compatibility_flags']) ? config['compatibility_flags'] : []
  const missing = REQUIRED_FLAGS.filter((flag) => !flags.includes(flag))
  findings.push(
    missing.length === 0
      ? pass('compatibility-flags', `compatibility_flags has ${REQUIRED_FLAGS.join(', ')}`)
      : fail(
          'compatibility-flags',
          `compatibility_flags lacks ${missing.join(', ')}`,
          `Add ${missing.map((flag) => `"${flag}"`).join(', ')} to compatibility_flags in wrangler.jsonc.`,
        ),
  )

  const vars = isRecord(config['vars']) ? config['vars'] : {}
  const url = vars['HOLLWARE_PUBLIC_URL']
  const urlOk =
    typeof url === 'string' && URL.canParse(url) && /^https?:$/.test(new URL(url).protocol)
  findings.push(
    urlOk
      ? pass('public-url', `HOLLWARE_PUBLIC_URL is ${new URL(url).origin}`)
      : fail(
          'public-url',
          'HOLLWARE_PUBLIC_URL is missing or is no http or https URL',
          'Set vars.HOLLWARE_PUBLIC_URL in wrangler.jsonc to the public URL of the Worker, such as https://cms.example.com.',
        ),
  )

  const db = records(config['d1_databases']).find((entry) => entry['binding'] === DEFAULT_BINDING)
  const migrationsDir =
    db !== undefined && typeof db['migrations_dir'] === 'string'
      ? join(cwd, db['migrations_dir'])
      : undefined
  const migrations =
    migrationsDir !== undefined && existsSync(migrationsDir)
      ? readdirSync(migrationsDir).filter((name) => name.endsWith('.sql'))
      : []
  findings.push(
    db === undefined
      ? fail(
          'd1-binding',
          `there is no D1 binding "${DEFAULT_BINDING}"`,
          'Add it to d1_databases in wrangler.jsonc, as the starter has it.',
        )
      : migrations.length === 0
        ? fail(
            'd1-binding',
            `the D1 binding "${DEFAULT_BINDING}" has no migrations in its migrations_dir`,
            'Set migrations_dir to "node_modules/@hollware/server/migrations", and install the dependencies.',
          )
        : pass(
            'd1-binding',
            `the D1 binding "${DEFAULT_BINDING}" has ${migrations.length} migrations`,
          ),
  )

  const kv = records(config['kv_namespaces']).some((entry) => entry['binding'] === 'OAUTH_KV')
  findings.push(
    kv
      ? pass('kv-binding', 'the KV binding "OAUTH_KV" is there')
      : fail(
          'kv-binding',
          'there is no KV binding "OAUTH_KV", which the OAuth server needs',
          'Add { "binding": "OAUTH_KV" } to kv_namespaces in wrangler.jsonc.',
        ),
  )

  const assets = isRecord(config['assets']) ? config['assets'] : undefined
  const directory = typeof assets?.['directory'] === 'string' ? assets['directory'] : undefined
  const admin = directory !== undefined && existsSync(join(cwd, directory, 'admin'))
  findings.push(
    admin
      ? pass('admin-assets', 'the admin is built, in the static assets')
      : fail(
          'admin-assets',
          'the static assets do not hold the admin',
          'Install the dependencies; assets.directory of wrangler.jsonc must be "node_modules/@hollware/admin/dist/client".',
        ),
  )
  return findings
}

/** What the database says: the migrations it lacks and whether it has an owner. */
async function checkDatabase(io: Io, target: Target): Promise<Finding[]> {
  const listed = await io.wrangler(['d1', 'migrations', 'list', DEFAULT_BINDING, `--${target}`])
  if (listed.code !== 0) {
    return [
      fail(
        'migrations-list',
        `wrangler could not list the migrations of the ${target} database: ${failureReason(listed)}`,
        target === 'remote'
          ? 'Run "wrangler login", then "hollware deploy".'
          : 'Check wrangler.jsonc.',
      ),
    ]
  }
  const pending = parsePendingMigrations(listed.stdout)
  if (pending.length > 0) {
    return [
      fail(
        'migrations',
        `the ${target} database lacks ${pending.length} ${pending.length === 1 ? 'migration' : 'migrations'}`,
        `Run "hollware migrate --${target}".`,
      ),
    ]
  }
  const [owners = []] = await query(io.wrangler, DEFAULT_BINDING, target, ownerQuery())
  return [
    pass('migrations', `the ${target} database has every migration`),
    owners.length > 0
      ? pass('owner', `the ${target} database has an owner`)
      : fail(
          'owner',
          `the ${target} database has no owner yet`,
          `Run "hollware init --site <key> --${target}", with the key your site is to have, such as my-site.`,
        ),
  ]
}

export async function doctor(argv: readonly string[], io: Io): Promise<number> {
  const { values } = parseFlags({
    args: [...argv],
    allowPositionals: false,
    options: {
      local: { type: 'boolean' },
      remote: { type: 'boolean' },
      json: { type: 'boolean' },
      help: { type: 'boolean' },
    },
  })
  if (values.help === true) {
    io.out(DOCTOR_USAGE)
    return 0
  }
  const target = chooseTarget(values)
  const file = join(io.cwd, 'wrangler.jsonc')
  if (!existsSync(file)) {
    throw new CliError(`${file} is missing: run hollware doctor in the directory of the project.`)
  }
  let config: unknown
  try {
    config = parseJsonc(readFileSync(file, 'utf8'))
  } catch (error) {
    throw new CliError(`wrangler.jsonc is not valid JSONC: ${String(error)}`)
  }
  if (!isRecord(config)) throw new CliError('wrangler.jsonc holds no object.')

  const findings = [...checkConfig(io.cwd, config), ...(await checkDatabase(io, target))]
  const failed = findings.filter((finding) => !finding.ok).length
  if (values.json === true) {
    io.out(
      JSON.stringify({
        ok: failed === 0,
        checks: findings.map((finding) => ({
          name: finding.name,
          ok: finding.ok,
          message: finding.what,
          fix: finding.fix ?? '',
        })),
      }),
    )
    return failed === 0 ? 0 : 1
  }
  io.out(
    findings
      .map((finding) =>
        finding.ok ? `ok    ${finding.what}` : `FAIL  ${finding.what}\n      ${finding.fix ?? ''}`,
      )
      .join('\n'),
  )
  if (failed === 0) {
    io.out('Everything Hollware needs is in place.')
    return 0
  }
  io.err(`hollware doctor: ${failed} ${failed === 1 ? 'problem' : 'problems'} to fix.`)
  return 1
}
