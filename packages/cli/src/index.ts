#!/usr/bin/env node
import { readFileSync, realpathSync } from 'node:fs'
import { pathToFileURL } from 'node:url'

// The planned commands. None of them is implemented yet.
const COMMANDS = [
  { name: 'init', summary: 'Set up Hollware in a project' },
  { name: 'migrate', summary: 'Apply D1 migrations' },
  { name: 'token', summary: 'Create, list and revoke access tokens' },
  { name: 'import', summary: 'Import Markdown files over MCP' },
  { name: 'export', summary: 'Export entries as Markdown files' },
]

const NAME_WIDTH = Math.max(...COMMANDS.map((command) => command.name.length))

const USAGE = [
  'Usage: hollware <command>',
  '',
  'Pre-alpha: no command is implemented yet.',
  '',
  'Commands:',
  ...COMMANDS.map(
    ({ name, summary }) => `  ${name.padEnd(NAME_WIDTH)}  ${summary} (not implemented yet)`,
  ),
  '',
  'Options:',
  '  --help     Show this help',
  '  --version  Print the version',
].join('\n')

// Read at runtime, next to this module: `../package.json` is the package manifest
// both from `src/index.ts` and from the built `dist/index.mjs`.
function readVersion(): string {
  const manifest: { version?: unknown } = JSON.parse(
    readFileSync(new URL('../package.json', import.meta.url), 'utf8'),
  )
  if (typeof manifest.version !== 'string') throw new Error('package.json has no version')
  return manifest.version
}

/**
 * Runs the CLI and returns its exit code. Each call to `io.out` or `io.err` is one
 * message; whoever owns the streams adds the trailing newline. Only the first
 * argument is looked at.
 */
export function main(
  argv: string[],
  io: { out: (s: string) => void; err: (s: string) => void },
): number {
  const [first] = argv
  if (first === undefined || first === '--help') {
    io.out(USAGE)
    return 0
  }
  if (first === '--version') {
    io.out(`hollware ${readVersion()}`)
    return 0
  }
  if (COMMANDS.some((command) => command.name === first)) {
    io.err(`hollware ${first}: not implemented yet`)
    return 1
  }
  io.err(`hollware: unknown command or flag "${first}"\n\n${USAGE}`)
  return 1
}

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

if (isEntryPoint()) {
  process.exitCode = main(process.argv.slice(2), {
    out: (s) => process.stdout.write(`${s}\n`),
    err: (s) => process.stderr.write(`${s}\n`),
  })
}
