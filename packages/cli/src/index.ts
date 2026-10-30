#!/usr/bin/env node
import { spawn } from 'node:child_process'
import { mkdtempSync, realpathSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import type { DevExit, DevHost } from './dev-host.ts'
import { CliError, UsageError } from './errors.ts'
import { printable } from './format.ts'
import type { Io } from './io.ts'
import { readVersion } from './version.ts'
import { createWranglerRunner } from './wrangler.ts'

export type { Io } from './io.ts'
export type { RunWrangler, WranglerResult } from './wrangler.ts'

const COMMANDS = [
  {
    name: 'init',
    summary: "Set up a site, its owner and a first token in the project's D1 database",
  },
  { name: 'dev', summary: "Start the project's local server and wait until it is ready" },
  { name: 'mcp-config', summary: 'Print the configuration that connects an MCP client' },
  { name: 'migrate', summary: 'Apply D1 migrations' },
  { name: 'deploy', summary: 'Deploy to Cloudflare and migrate the remote database' },
  { name: 'doctor', summary: 'Check the project, its bindings, its database and its owner' },
  { name: 'token', summary: 'Create, list and revoke personal tokens' },
  { name: 'invite', summary: 'Invite a person to the admin, as an editor or an author' },
  { name: 'agent', summary: 'Add, list and remove the agent members of a site' },
  { name: 'import', summary: 'Import Markdown files over MCP' },
  { name: 'export', summary: 'Export entries as Markdown files over MCP' },
  { name: 'promote', summary: 'Copy what one Hollware publishes to another, as one review' },
  { name: 'backup', summary: 'List the daily backups of a site, and write one as files' },
  {
    name: 'analytics',
    summary: "Connect the site's own analytics, so agents see what readers read",
  },
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
  'init, dev, migrate, deploy, doctor, token, invite and agent work on the project in the current',
  'directory, through its wrangler.',
].join('\n')

const SUBCOMMANDS: Readonly<Record<string, readonly string[]>> = {
  token: ['create', 'list', 'revoke'],
  agent: ['add', 'list', 'remove'],
}

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
    ![
      'init',
      'dev',
      'mcp-config',
      'migrate',
      'deploy',
      'doctor',
      'token',
      'invite',
      'agent',
      'import',
      'export',
      'promote',
      'backup',
      'analytics',
    ].includes(first)
  ) {
    io.err(`hollware: unknown command or flag "${printable(first)}"\n\n${USAGE}`)
    return 1
  }
  const label = SUBCOMMANDS[first]?.includes(rest[0] ?? '') === true ? `${first} ${rest[0]}` : first
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

async function run(command: string, args: string[], io: Io): Promise<number> {
  switch (command) {
    case 'init':
      return (await import('./commands/init.ts')).init(args, io)
    case 'dev':
      return (await import('./commands/dev.ts')).dev(args, io)
    case 'mcp-config':
      return (await import('./commands/mcp-config.ts')).mcpConfig(args, io)
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
    case 'agent':
      return (await import('./commands/agent.ts')).agent(args, io)
    case 'export':
      return (await import('./commands/export.ts')).exportContent(args, io)
    case 'promote':
      return (await import('./commands/promote.ts')).promote(args, io)
    case 'backup':
      return (await import('./commands/backup.ts')).backup(args, io)
    case 'analytics':
      return (await import('./commands/analytics.ts')).analytics(args, io)
    default:
      return (await import('./commands/import.ts')).importContent(args, io)
  }
}

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
    dev: processDevHost(),
  }
}

function processDevHost(): DevHost {
  const SIGNALS = ['SIGINT', 'SIGTERM', 'SIGHUP'] as const
  return {
    spawn: (bin, args, cwd, { detached }) => {
      const child = spawn(bin, [...args], {
        cwd,
        detached: true,
        stdio: detached ? 'ignore' : ['ignore', 'pipe', 'pipe'],
      })
      let output = ''
      const keep = (chunk: Buffer) => {
        output = `${output}${chunk.toString('utf8')}`.slice(-4000)
      }
      child.stdout?.on('data', keep)
      child.stderr?.on('data', keep)
      const exited = new Promise<DevExit>((resolve) => {
        child.on('error', (error) => {
          output += `\n${error.message}`
          resolve({ code: 1, signal: null })
        })
        child.on('close', (code, signal) => resolve({ code, signal }))
      })
      if (child.pid === undefined) {
        throw new CliError(`could not run ${bin}: is it executable?`)
      }
      if (detached) child.unref()
      return {
        pid: child.pid,
        exited,
        tail: () => output.split('\n').slice(-30).join('\n'),
      }
    },
    killGroup: (pid, signal) => {
      if (!Number.isInteger(pid) || pid <= 1) return
      try {
        process.kill(-pid, signal)
      } catch {}
    },
    isAlive: (pid) => {
      try {
        process.kill(pid, 0)
        return true
      } catch (error) {
        return error instanceof Error && 'code' in error && error.code === 'EPERM'
      }
    },
    onSignal: (callback) => {
      const handler = () => callback()
      for (const signal of SIGNALS) process.on(signal, handler)
      return () => {
        for (const signal of SIGNALS) process.off(signal, handler)
      }
    },
    healthy: async (url) => {
      try {
        const response = await fetch(`${url}/health`, { signal: AbortSignal.timeout(2000) })
        await response.body?.cancel()
        return response.status === 200
      } catch {
        return false
      }
    },
    sleep: (ms, cancel) =>
      new Promise((resolve) => {
        const timer = setTimeout(resolve, ms)
        cancel?.addEventListener('abort', () => {
          clearTimeout(timer)
          resolve()
        })
      }),
  }
}

if (isEntryPoint()) {
  process.exitCode = await main(process.argv.slice(2), processIo())
}
