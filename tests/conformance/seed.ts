import { readFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { findWrangler } from '../../packages/cli/src/wrangler.ts'
import { isPersonalToken } from '../../packages/core/src/tokens.ts'
import { runProcess } from './processes.ts'

/**
 * Seeds the local database of the Worker under test with the real CLI of Hollware, the way a
 * person sets a project up: `hollware migrate --local`, then `hollware init --local`, which
 * creates the site, its owner and a first token with every scope, and `hollware token create`
 * for a token that can only read. Nothing here writes SQL.
 */

/** The site of `worker/hollware.config.ts`: the key the CLI writes and the config accepts. */
export const SITE_KEY = 'conformance'

/** Where the local D1 of `wrangler dev` and of `wrangler d1 execute --local` keeps its state. */
export function localState(workerDirectory: string): string {
  return join(workerDirectory, '.wrangler', 'state')
}

/** Starts from an empty database: `init` refuses a database that already has an owner. */
export function resetLocalState(workerDirectory: string): void {
  rmSync(localState(workerDirectory), { recursive: true, force: true })
}

/** The command that runs the bin of the CLI, as its package.json names it. */
export function cliCommand(repository: string): { command: string; args: string[] } {
  const manifest: unknown = JSON.parse(
    readFileSync(join(repository, 'packages', 'cli', 'package.json'), 'utf8'),
  )
  const bin =
    typeof manifest === 'object' && manifest !== null && 'bin' in manifest
      ? manifest.bin
      : undefined
  const entry =
    typeof bin === 'object' && bin !== null && 'hollware' in bin ? bin.hollware : undefined
  if (typeof entry !== 'string') {
    throw new Error('packages/cli/package.json names no bin "hollware"')
  }
  // Inside the workspace the bin is the source (ADR-016), which Node runs as it is.
  return { command: process.execPath, args: [join(repository, 'packages', 'cli', entry)] }
}

/**
 * The personal token in the output of `hollware init`: the line that holds only a token. The
 * CLI prints it once, with the site, the owner and the scopes around it.
 */
export function readToken(output: string): string {
  const found = output
    .split('\n')
    .map((line) => line.trim())
    .filter(isPersonalToken)
  const [token] = found
  if (token === undefined || found.length !== 1) {
    throw new Error('the output of "hollware init" does not hold exactly one personal token')
  }
  return token
}

export interface Seeded {
  /** The token of the owner, with every scope: what the proxy gives the suite. */
  readonly token: string
  /** A token with `content:read` and nothing else, for the probes of `claims.ts`. */
  readonly readOnlyToken: string
}

/** Migrates and initializes the local database of the Worker, and gives its two tokens. */
export async function seed(options: {
  readonly repository: string
  readonly workerDirectory: string
  readonly env: NodeJS.ProcessEnv
}): Promise<Seeded> {
  if (findWrangler(options.workerDirectory) === undefined) {
    throw new Error(`no wrangler is installed in ${options.workerDirectory} or above it`)
  }
  const cli = cliCommand(options.repository)
  const run = async (args: string[]): Promise<string> => {
    const result = await runProcess({
      command: cli.command,
      args: [...cli.args, ...args],
      cwd: options.workerDirectory,
      env: options.env,
    })
    if (result.code !== 0) {
      // The output of `init` holds the token, so it is shown only when the command failed.
      throw new Error(`hollware ${args.join(' ')} exited with ${result.code}:\n${result.output}`)
    }
    return result.output
  }
  await run(['migrate', '--local'])
  const initialized = await run(['init', '--local', '--site', SITE_KEY])
  const readOnly = await run([
    'token',
    'create',
    '--local',
    '--site',
    SITE_KEY,
    '--label',
    'conformance-read-only',
    '--scopes',
    'content:read',
  ])
  return { token: readToken(initialized), readOnlyToken: readToken(readOnly) }
}
