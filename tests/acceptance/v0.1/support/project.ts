import {
  chmodSync,
  cpSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { query, type Row } from '../../../../packages/cli/src/d1.ts'
import { createWranglerRunner, findWrangler } from '../../../../packages/cli/src/wrangler.ts'
import {
  freePort,
  runProcess,
  startProcess,
  waitForWorker,
  type ManagedProcess,
} from '../../../conformance/processes.ts'
import { cliCommand, readToken } from '../../../conformance/seed.ts'

/**
 * A user's project made of the built playground: a directory that holds the Worker as `vp build`
 * wrote it (`apps/playground/dist/hollware_playground`, which the global setup builds), where the
 * CLI and wrangler run as they run in a project, on a local D1 of its own. `start()` serves it with
 * `wrangler dev` on a free port of the loopback address, and that address is the Worker's
 * `HOLLWARE_PUBLIC_URL`, so an agent reaches it over HTTP the way it reaches a deployment.
 *
 * The directory is a temporary one, outside the repository. Its `node_modules` is a link to the
 * repository's, which is where the CLI finds wrangler, as it finds it in a project. Whatever else
 * a test writes (the log of `wrangler dev`, a token file, content to import) goes in the directory
 * above it: `wrangler dev` watches the project and restarts the Worker when a file changes there.
 */

const REPOSITORY = join(import.meta.dirname, '..', '..', '..', '..')
const BUILT = join(REPOSITORY, 'apps', 'playground', 'dist', 'hollware_playground')
const MIGRATIONS = join(REPOSITORY, 'packages', 'server', 'migrations')
const ASSETS = join(REPOSITORY, 'apps', 'playground', 'dist', 'client')

/** The site of the playground: its key in apps/playground/hollware.config.ts. */
export const SITE_KEY = 'playground'

/** `wrangler dev` bundles nothing here, but starting workerd takes seconds on a busy machine. */
const START_TIMEOUT_MS = 120_000

export interface CommandResult {
  /** The exit code, or `null` when a signal ended the command. */
  readonly code: number | null
  /** What it wrote, stdout and stderr together. */
  readonly output: string
}

export interface Project {
  /** The project: the built Worker, its wrangler.json and its local D1. */
  readonly directory: string
  /** A directory beside the project, for the files of a test. */
  readonly scratch: string
  /** Runs `hollware <args>` in the project, as its owner would. */
  hollware(...args: string[]): Promise<CommandResult>
  /** Runs SQL on the local D1 through wrangler, and gives the rows of each statement. */
  query(sql: string): Promise<Row[][]>
  /** Writes a file beside the project that only its owner can read, and gives its path. */
  writeSecret(name: string, content: string): string
  /**
   * Serves the Worker with `wrangler dev`, and gives its URL: its public URL. A test that needs a
   * name and not an address there, as WebAuthn does, asks for `localhost`; the port is a free one
   * unless it says which.
   */
  start(options?: {
    readonly hostname?: 'localhost'
    readonly port?: number
    /** More variables of the Worker, such as HOLLWARE_SECRET. */
    readonly vars?: Readonly<Record<string, string>>
  }): Promise<string>
  /** Stops what the project started and deletes its directories. */
  close(): Promise<void>
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * The build's wrangler.json names the migrations, and the static assets that hold the admin,
 * relative to the playground. The copy names them by their absolute paths: the server's
 * migrations are the files `hollware migrate` applies in a project, from
 * `node_modules/@hollware/server/migrations`, and the assets are the build's own.
 */
function pointAtMigrations(directory: string): void {
  const path = join(directory, 'wrangler.json')
  const config: unknown = JSON.parse(readFileSync(path, 'utf8'))
  const databases = isRecord(config) ? config['d1_databases'] : undefined
  const [database] = Array.isArray(databases) ? databases : []
  if (!isRecord(config) || !isRecord(database)) {
    throw new Error(`${path} has no D1 database`)
  }
  database['migrations_dir'] = MIGRATIONS
  const assets = config['assets']
  if (isRecord(assets)) assets['directory'] = ASSETS
  writeFileSync(path, JSON.stringify(config))
}

/** A copy of the built playground, ready for `hollware migrate`. */
export function createProject(): Project {
  const scratch = mkdtempSync(join(tmpdir(), 'hollware-acceptance-'))
  const directory = join(scratch, 'project')
  cpSync(BUILT, directory, { recursive: true })
  // What the build directory may hold of an earlier run: never the state of this project.
  rmSync(join(directory, '.wrangler'), { recursive: true, force: true })
  symlinkSync(join(REPOSITORY, 'node_modules'), join(directory, 'node_modules'))
  pointAtMigrations(directory)
  // The playground is a project with a config, which its Worker moves into the database (ADR-033):
  // `hollware init` sees it there, as in apps/playground, and leaves the structure to the move.
  cpSync(
    join(REPOSITORY, 'apps', 'playground', 'hollware.config.ts'),
    join(directory, 'hollware.config.ts'),
  )

  const env: NodeJS.ProcessEnv = { ...process.env, WRANGLER_SEND_METRICS: 'false' }
  const cli = cliCommand(REPOSITORY)
  const wrangler = findWrangler(directory)
  if (wrangler === undefined) throw new Error(`no wrangler is installed above ${directory}`)
  let dev: ManagedProcess | undefined

  return {
    directory,
    scratch,
    hollware: (...args) =>
      runProcess({ command: cli.command, args: [...cli.args, ...args], cwd: directory, env }),
    query: (sql) => query(createWranglerRunner(directory), 'DB', 'local', sql),
    writeSecret: (name, content) => {
      const path = join(scratch, name)
      writeFileSync(path, content, { mode: 0o600 })
      chmodSync(path, 0o600)
      return path
    },
    start: async (options = {}) => {
      const port = options.port ?? (await freePort())
      const inspectorPort = await freePort()
      const url = `http://${options.hostname ?? '127.0.0.1'}:${port}`
      dev = startProcess({
        command: wrangler,
        args: [
          'dev',
          '--local',
          '--ip',
          '127.0.0.1',
          '--port',
          String(port),
          '--inspector-port',
          String(inspectorPort),
          '--show-interactive-dev-session=false',
          '--var',
          `HOLLWARE_PUBLIC_URL:${url}`,
          ...Object.entries(options.vars ?? {}).flatMap(([name, value]) => [
            '--var',
            `${name}:${value}`,
          ]),
        ],
        cwd: directory,
        env,
        logFile: join(scratch, 'wrangler-dev.log'),
      })
      await waitForWorker({
        port,
        host: `${options.hostname ?? '127.0.0.1'}:${port}`,
        process: dev,
        timeoutMs: START_TIMEOUT_MS,
      })
      return url
    },
    close: async () => {
      await dev?.stop()
      rmSync(scratch, { recursive: true, force: true })
    },
  }
}

/**
 * Migrates the project's database and runs `hollware init` for the playground's site, as the
 * owner of a new project does, and gives the owner's token, which init prints once.
 */
export async function setUpProject(project: Project): Promise<string> {
  const migrated = await project.hollware('migrate', '--local')
  if (migrated.code !== 0) throw new Error(`hollware migrate failed:\n${migrated.output}`)
  const initialized = await project.hollware('init', '--local', '--site', SITE_KEY)
  if (initialized.code !== 0) throw new Error(`hollware init failed with ${initialized.code}`)
  return readToken(initialized.output)
}
