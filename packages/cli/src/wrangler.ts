import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { CliError } from './errors.ts'

/** What a run of wrangler left behind. */
export interface WranglerResult {
  /** The exit code; 1 when wrangler was killed by a signal. */
  code: number
  stdout: string
  stderr: string
}

/** Runs the project's wrangler with these arguments, from the project directory. */
export type RunWrangler = (args: readonly string[]) => Promise<WranglerResult>

/**
 * The `wrangler` of the project: the nearest `node_modules/.bin/wrangler` from `cwd` upwards,
 * so a workspace that hoists its dependencies finds it too. Never a global wrangler, never
 * `npx`: the CLI runs the version the project pinned.
 */
export function findWrangler(cwd: string): string | undefined {
  let directory = cwd
  for (;;) {
    const candidate = join(directory, 'node_modules', '.bin', 'wrangler')
    if (existsSync(candidate)) return candidate
    const parent = dirname(directory)
    if (parent === directory) return undefined
    directory = parent
  }
}

/**
 * A runner that starts the project's wrangler as a child process in `cwd`. Its stdin is closed
 * and its output is captured, so wrangler runs without a terminal and never asks anything. It
 * inherits the environment, which is where wrangler finds its Cloudflare credentials.
 */
export function createWranglerRunner(cwd: string): RunWrangler {
  return (args) => {
    const bin = findWrangler(cwd)
    if (bin === undefined) {
      return Promise.reject(
        new CliError(
          `wrangler is not installed in ${cwd} or any directory above it. Install it in the project (for example "pnpm add -D wrangler") and run hollware from the project directory.`,
        ),
      )
    }
    return new Promise<WranglerResult>((resolve, reject) => {
      const child = spawn(bin, [...args], { cwd, stdio: ['ignore', 'pipe', 'pipe'] })
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
        reject(new CliError(`could not run ${bin}: ${error.message}`))
      })
      child.on('close', (code, signal) => {
        if (signal !== null) stderr += `\nwrangler was stopped by ${signal}`
        resolve({ code: code ?? 1, stdout, stderr })
      })
    })
  }
}

// The colors wrangler puts in its messages: removed before anything is shown or parsed.
const ANSI = new RegExp(String.raw`\u001B\[[0-9;]*[A-Za-z]`, 'g')

/** `text` without terminal escape sequences. */
export function stripAnsi(text: string): string {
  return text.replace(ANSI, '')
}

const MAX_REASON = 400

/**
 * Why a run of wrangler failed, in one line: the `error` of its `--json` answer, else the text
 * of its first `[ERROR]` message, else the last line it wrote to stderr or, failing that, to
 * stdout.
 */
export function failureReason(result: WranglerResult): string {
  const stdout = stripAnsi(result.stdout)
  const stderr = stripAnsi(result.stderr)
  const fromJson = jsonError(stdout.trim())
  if (fromJson !== undefined) return oneLine(fromJson)
  const stderrLines = linesOf(stderr)
  for (const line of stderrLines) {
    const message = /^\W*\[ERROR\]\s*(.+)$/.exec(line)?.[1]
    if (message !== undefined) return oneLine(message)
  }
  const last = stderrLines.at(-1) ?? linesOf(stdout).at(-1)
  return oneLine(last ?? `wrangler exited with code ${result.code} and printed nothing`)
}

function linesOf(text: string): string[] {
  return text
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line !== '' && !line.includes('Logs were written to'))
}

function jsonError(stdout: string): string | undefined {
  try {
    const parsed: unknown = JSON.parse(stdout)
    if (typeof parsed !== 'object' || parsed === null || !('error' in parsed)) return undefined
    const { error } = parsed
    if (typeof error === 'string') return error
    if (typeof error === 'object' && error !== null && 'text' in error) {
      return typeof error.text === 'string' ? error.text : undefined
    }
    return undefined
  } catch {
    return undefined
  }
}

function oneLine(text: string): string {
  const collapsed = text.replace(/\s+/g, ' ').trim()
  return collapsed.length > MAX_REASON ? `${collapsed.slice(0, MAX_REASON)}…` : collapsed
}
