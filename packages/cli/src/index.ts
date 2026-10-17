#!/usr/bin/env node
import { mkdtempSync, realpathSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { CliError, UsageError } from './errors.ts'
import { printable } from './format.ts'
import type { Io } from './io.ts'
import { readVersion } from './version.ts'
import { createWranglerRunner } from './wrangler.ts'

export type { Io } from './io.ts'
export type { RunWrangler, WranglerResult } from './wrangler.ts'
export { createWranglerRunner } from './wrangler.ts'

const COMMANDS = [
  {
    name: 'init',
    summary: "Set up a site, its owner and a first token in the project's D1 database",
  },
  { name: 'migrate', summary: 'Apply D1 migrations' },
  { name: 'deploy', summary: 'Deploy to Cloudflare and migrate the remote database' },
  { name: 'doctor', summary: 'Check the project, its bindings, its database and its owner' },
  { name: 'token', summary: 'Create, list and revoke personal tokens' },
  { name: 'invite', summary: 'Invite a person to the admin, as an editor or an author' },
  { name: 'import', summary: 'Import Markdown files over MCP' },
  { name: 'export', summary: 'Export entries as Markdown files over MCP' },
]

const NAME_WIDTH = Math.max(...COMMANDS.map((command) => command.name.length))

const USAGE = [
  'Usage: hollware <command> [options]',
  '',
  'Commands:',
  ...COMMANDS.map(({ name, summary }) => `  ${name.padEnd(NAME_WIDTH)}  ${summary}`),
  '',
  'Options:',
  '  --help     Show this help',
  '  --version  Print the version',
  '',
  'Run "hollware <command> --help" for the options of a command.',
  'init, migrate, deploy, doctor, token and invite work on the project in the current directory,',
  'through its wrangler.',
].join('\n')

const TOKEN_COMMANDS = ['create', 'list', 'revoke']

/**
 * Runs the CLI and returns its exit code. Each call to `io.out` or `io.err` is one message;
 * whoever owns the streams adds the trailing newline. The command is the first argument; the
 * rest are its own. A `CliError` becomes one message on stderr and the exit code 1, and
 * anything else is a bug, which escapes.
 */
export async function main(argv: string[], io: Io): Promise<number> {
  const [first, ...rest] = argv
  if (first === undefined || first === '--help') {
    io.out(USAGE)
    return 0
  }
  if (first === '--version') {
    io.out(`hollware ${readVersion()}`)
    return 0
  }
  if (
    !['init', 'migrate', 'deploy', 'doctor', 'token', 'invite', 'import', 'export'].includes(first)
  ) {
    io.err(`hollware: unknown command or flag "${printable(first)}"\n\n${USAGE}`)
    return 1
  }
  const label =
    first === 'token' && TOKEN_COMMANDS.includes(rest[0] ?? '') ? `token ${rest[0]}` : first
  try {
    return await run(first, rest, io)
  } catch (error) {
    if (!(error instanceof CliError)) throw error
    const hint =
      error instanceof UsageError ? ` Run "hollware ${label} --help" for the options.` : ''
    io.err(`hollware ${label}: ${error.message}${hint}`)
    return 1
  }
}

// Each command loads when it runs, so that `--help` and `--version` do not pay for the MCP client.
async function run(command: string, args: string[], io: Io): Promise<number> {
  switch (command) {
    case 'init':
      return (await import('./commands/init.ts')).init(args, io)
    case 'migrate':
      return (await import('./commands/migrate.ts')).migrate(args, io)
    case 'deploy':
      return (await import('./commands/deploy.ts')).deploy(args, io)
    case 'doctor':
      return (await import('./commands/doctor.ts')).doctor(args, io)
    case 'token':
      return (await import('./commands/token.ts')).token(args, io)
    case 'invite':
      return (await import('./commands/invite.ts')).invite(args, io)
    case 'export':
      return (await import('./commands/export.ts')).exportContent(args, io)
    default:
      return (await import('./commands/import.ts')).importContent(args, io)
  }
}

// ---------------------------------------------------------------------------------------------
// The entry point. Everything above uses only its arguments; this is the one place that touches
// `process` (argv, the streams, the working directory, the exit code).

// True when this module is the process entry point. The path goes through
// `realpathSync` because npm links a bin as a symlink, while `import.meta.url` is
// always the real path.
function isEntryPoint(): boolean {
  const entry = process.argv[1]
  if (entry === undefined) return false
  try {
    return pathToFileURL(realpathSync(entry)).href === import.meta.url
  } catch {
    return false
  }
}

async function readStdin(): Promise<string | undefined> {
  if (process.stdin.isTTY) return undefined
  const chunks: Buffer[] = []
  for await (const chunk of process.stdin) chunks.push(Buffer.from(chunk))
  return Buffer.concat(chunks).toString('utf8')
}

function processIo(): Io {
  const cwd = process.cwd()
  return {
    out: (message) => process.stdout.write(`${message}\n`),
    err: (message) => process.stderr.write(`${message}\n`),
    cwd,
    now: () => new Date(),
    randomBytes: (length) => crypto.getRandomValues(new Uint8Array(length)),
    readStdin,
    wrangler: createWranglerRunner(cwd),
    tempDir: () => mkdtempSync(join(tmpdir(), 'hollware-')),
  }
}

if (isEntryPoint()) {
  process.exitCode = await main(process.argv.slice(2), processIo())
}
