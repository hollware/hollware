import { cpSync, existsSync, readdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { basename, join, resolve } from 'node:path'
import { parseArgs } from 'node:util'

/** What a run of another program left behind. */
export interface RunResult {
  readonly code: number
  readonly stdout: string
  readonly stderr: string
}

/** Everything create-hollware takes from the outside world; a test hands in a fake of each part. */
export interface Io {
  /** One message for stdout. */
  readonly out: (message: string) => void
  /** One message for stderr. */
  readonly err: (message: string) => void
  /** Where the new directory is made, unless it is absolute. */
  readonly cwd: string
  /** The project template this package ships, made from templates/starter. */
  readonly templateDir: string
  /** The version of create-hollware: the version of Hollware the project gets. */
  readonly version: string
  /** Runs a program in a directory, with its output captured. */
  readonly run: (command: string, args: readonly string[], cwd: string) => Promise<RunResult>
}

export const USAGE = [
  'Usage: npm create hollware [<dir>] [options]',
  '',
  'Creates a Hollware project in <dir>: a config, a Worker and the Wrangler config that binds',
  'its database. Then it installs the dependencies, applies the migrations to the local database',
  'and makes your site, its owner and a first token, and says how to connect your agent.',
  '',
  'Options:',
  '  --name <name>    The name of the Worker and of its database (default: the name of <dir>)',
  '  --site <key>     The key of your site, such as my-site; it never changes (default: my-site)',
  '  --preset <name>  What the site starts with: blog, docs or empty (default: blog)',
  '  --locales <list> Its locales, comma-separated, the first the default (default: en)',
  '  --pm <npm|pnpm>  The package manager that installs (default: npm)',
  '  --yes            Take the defaults: <dir> is my-hollware when it is not given',
  '  --no-install     Do not install, migrate or make the site',
  '  --no-git         Do not run git init',
  '  --help           Show this help',
  '  --version        Print the version',
].join('\n')

/** A mistake in the arguments: the message, then the usage. */
export class UsageError extends Error {
  override readonly name = 'UsageError'
}

/** Anything else that stops the run: one message, no usage. */
export class CreateError extends Error {
  override readonly name = 'CreateError'
}

/** A Worker's name: lowercase letters, digits and hyphens, as Cloudflare takes it. */
const WORKER_NAME = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/
/** A site key, as a site's definition takes it (ADR-033). */
const SITE_KEY = /^[a-z0-9]+(?:-[a-z0-9]+)*$/
/** What `@hollware/*` and `hollware` say in the template's package.json. */
const VERSION_PLACEHOLDER = 'HOLLWARE_VERSION'
const TOKEN = /hw_pat_[0-9a-hjkmnp-tv-z]{52}/

export interface Choices {
  readonly dir: string
  readonly name: string
  readonly site: string
  readonly pm: 'npm' | 'pnpm'
  readonly install: boolean
  readonly git: boolean
  /** `--preset` and `--locales` as given, for `hollware init`, which checks them. */
  readonly initFlags: readonly string[]
}

/** The choices of a run, from its arguments. */
export function readChoices(argv: readonly string[]): Choices {
  const { values, positionals } = (() => {
    try {
      return parseArgs({
        args: [...argv],
        allowPositionals: true,
        options: {
          name: { type: 'string' },
          site: { type: 'string' },
          preset: { type: 'string' },
          locales: { type: 'string' },
          pm: { type: 'string' },
          yes: { type: 'boolean' },
          'no-install': { type: 'boolean' },
          'no-git': { type: 'boolean' },
        },
      })
    } catch (error) {
      throw new UsageError(error instanceof Error ? error.message : String(error))
    }
  })()
  if (positionals.length > 1) {
    throw new UsageError(`one directory, at most: got ${positionals.join(', ')}`)
  }
  const [given] = positionals
  if (given === undefined && values.yes !== true) {
    throw new UsageError('name the directory of the project, or pass --yes for "my-hollware"')
  }
  const dir = given ?? 'my-hollware'
  const name = values.name ?? basename(resolve(dir)).toLowerCase()
  if (!WORKER_NAME.test(name)) {
    throw new UsageError(
      `"${name}" is no Worker name: use lowercase letters, digits and hyphens, or pass --name`,
    )
  }
  const site = values.site ?? 'my-site'
  if (!SITE_KEY.test(site)) {
    throw new UsageError(`"${site}" is no site key: use lowercase words joined by hyphens`)
  }
  const pm = values.pm ?? 'npm'
  if (pm !== 'npm' && pm !== 'pnpm') throw new UsageError(`--pm is npm or pnpm, not "${pm}"`)
  return {
    dir,
    name,
    site,
    pm,
    install: values['no-install'] !== true,
    git: values['no-git'] !== true,
    initFlags: [
      ...(values.preset === undefined ? [] : ['--preset', values.preset]),
      ...(values.locales === undefined ? [] : ['--locales', values.locales]),
    ],
  }
}

function replaceIn(path: string, replacements: readonly (readonly [string, string])[]): void {
  let text = readFileSync(path, 'utf8')
  for (const [from, to] of replacements) text = text.split(from).join(to)
  writeFileSync(path, text)
}

/** Copies the template into `target` and makes it this project's. */
export function writeProject(io: Io, target: string, choices: Choices): void {
  cpSync(io.templateDir, target, { recursive: true })
  // npm leaves .gitignore out of a package, so the template holds it as gitignore.
  renameSync(join(target, 'gitignore'), join(target, '.gitignore'))
  replaceIn(join(target, 'package.json'), [
    ['"name": "my-hollware"', `"name": ${JSON.stringify(choices.name)}`],
    [`"${VERSION_PLACEHOLDER}"`, JSON.stringify(io.version)],
  ])
  replaceIn(join(target, 'wrangler.jsonc'), [
    ['"name": "my-hollware"', `"name": "${choices.name}"`],
    ['"database_name": "my-hollware"', `"database_name": "${choices.name}"`],
    // Queue names are unique in an account: each project has its own.
    ['hollware-events', `${choices.name}-events`],
  ])
  for (const file of ['README.md']) {
    replaceIn(join(target, file), [['my-site', choices.site]])
  }
  if (choices.pm === 'pnpm') writeFileSync(join(target, 'pnpm-workspace.yaml'), PNPM_WORKSPACE)
}

/**
 * pnpm runs no build script it was not told about, and fails the install on one. esbuild ships the
 * binary wrangler uses; workerd's binary arrives through optionalDependencies, so its script is
 * not needed.
 */
export const PNPM_WORKSPACE = `allowBuilds:
  esbuild: true
  workerd: false
`

async function step(io: Io, what: string, command: string, args: string[], cwd: string) {
  const result = await io.run(command, args, cwd)
  if (result.code !== 0) {
    const detail = (result.stderr.trim() || result.stdout.trim()).split('\n').slice(-30).join('\n')
    throw new CreateError(`${what} failed (${command} ${args.join(' ')}):\n${detail}`)
  }
  return result
}

/** Makes the project, and everything it needs to run locally. */
export async function create(argv: readonly string[], io: Io): Promise<number> {
  const choices = readChoices(argv)
  const target = resolve(io.cwd, choices.dir)
  if (existsSync(target) && readdirSync(target).length > 0) {
    throw new CreateError(`${target} is not empty: choose a new directory.`)
  }
  writeProject(io, target, choices)
  io.out(`Created a Hollware project in ${target}.`)
  if (choices.git) await step(io, 'git init', 'git', ['init', '--quiet'], target)
  if (!choices.install) {
    io.out(
      [
        '',
        'Next:',
        `  cd ${choices.dir}`,
        `  ${choices.pm} install`,
        `  ${choices.pm} exec hollware migrate --local`,
        `  ${choices.pm} exec hollware init --site ${[choices.site, ...choices.initFlags].join(' ')} --local`,
      ].join('\n'),
    )
    return 0
  }

  io.out(`Installing with ${choices.pm} ...`)
  await step(io, 'The install', choices.pm, ['install'], target)
  const hollware = join(target, 'node_modules', '.bin', 'hollware')
  await step(io, 'The migrations', hollware, ['migrate', '--local'], target)
  const init = await step(
    io,
    'Making the site',
    hollware,
    ['init', '--site', choices.site, ...choices.initFlags, '--local'],
    target,
  )
  io.out(init.stdout.trim())
  const token = TOKEN.exec(init.stdout)?.[0] ?? '<the token above>'
  io.out(
    [
      '',
      'Start it, and connect your agent (Claude Code):',
      `  cd ${choices.dir}`,
      `  ${choices.pm === 'npm' ? 'npm run dev' : 'pnpm dev'}`,
      `  claude mcp add --transport http hollware http://localhost:5199/mcp --header "Authorization: Bearer ${token}"`,
      '',
      'The admin is at http://localhost:5199/admin/. To deploy, log in to Cloudflare and run:',
      `  ${choices.pm} exec wrangler login`,
      `  ${choices.pm} run deploy`,
      'The README says the rest.',
    ].join('\n'),
  )
  return 0
}
