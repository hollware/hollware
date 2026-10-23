#!/usr/bin/env node
import { spawn } from 'node:child_process'
import { readFileSync, realpathSync } from 'node:fs'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { create, CreateError, USAGE, UsageError, type Io, type RunResult } from './scaffold.ts'

export { USAGE } from './scaffold.ts'
export type { Io } from './scaffold.ts'

function readVersion(): string {
  const manifest: { version?: unknown } = JSON.parse(
    readFileSync(new URL('../package.json', import.meta.url), 'utf8'),
  )
  if (typeof manifest.version !== 'string') throw new Error('package.json has no version')
  return manifest.version
}

/**
 * Runs the CLI and returns its exit code. Each call to `io.out` or `io.err` is one message;
 * whoever owns the streams adds the trailing newline. `--help` and `--version` need nothing but
 * the streams; making a project takes the rest of `io`, which `defaults` fills in.
 */
export async function main(
  argv: string[],
  io: Pick<Io, 'out' | 'err'> & Partial<Omit<Io, 'out' | 'err'>>,
): Promise<number> {
  const [first] = argv
  if (first === undefined || first === '--help') {
    io.out(USAGE)
    return 0
  }
  if (first === '--version') {
    io.out(`create-hollware ${readVersion()}`)
    return 0
  }
  try {
    return await create(argv, {
      cwd: io.cwd ?? process.cwd(),
      templateDir: io.templateDir ?? fileURLToPath(new URL('../template', import.meta.url)),
      version: io.version ?? readVersion(),
      run: io.run ?? runProgram,
      out: io.out,
      err: io.err,
    })
  } catch (error) {
    if (error instanceof UsageError) {
      io.err(`create-hollware: ${error.message}\n\n${USAGE}`)
      return 1
    }
    if (error instanceof CreateError) {
      io.err(`create-hollware: ${error.message}`)
      return 1
    }
    throw error
  }
}

function runProgram(command: string, args: readonly string[], cwd: string): Promise<RunResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, [...args], { cwd, stdio: ['ignore', 'pipe', 'pipe'] })
    let stdout = ''
    let stderr = ''
    child.stdout.setEncoding('utf8')
    child.stderr.setEncoding('utf8')
    child.stdout.on('data', (chunk: string) => {
      stdout += chunk
    })
    child.stderr.on('data', (chunk: string) => {
      stderr += chunk
    })
    child.on('error', (error) => {
      reject(new CreateError(`could not run ${command}: ${error.message}`))
    })
    child.on('close', (code) => {
      resolve({ code: code ?? 1, stdout, stderr })
    })
  })
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

if (isEntryPoint()) {
  process.exitCode = await main(process.argv.slice(2), {
    out: (s) => process.stdout.write(`${s}\n`),
    err: (s) => process.stderr.write(`${s}\n`),
  })
}
