import { type ChildProcess, spawn } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'
import { constants } from 'node:os'
import { resolve } from 'node:path'
import { setTimeout as sleep } from 'node:timers/promises'
import { pathToFileURL } from 'node:url'
import { parseArgs } from 'node:util'

export type Verdict = 'CAUGHT' | 'NOT CAUGHT' | 'ERROR'

export const DEFAULT_TIMEOUT_SECONDS = 60

export const MAX_TIMEOUT_SECONDS = 2_147_483

const INTERRUPT_SIGNALS: NodeJS.Signals[] = ['SIGINT', 'SIGTERM', 'SIGHUP']

const KILL_GRACE_MS = 3000
const KILL_WAIT_MS = 5000
const POLL_MS = 20

export interface BreakLineOptions {
  file: string
  find: string
  replace: string
  command: string
  args: string[]
  timeoutSeconds: number
  cwd?: string
  inheritOutput?: boolean
  abort?: AbortSignal
  killGraceMs?: number
}

export interface BreakLineResult {
  verdict: Verdict
  reason: string
}

type Outcome =
  | { kind: 'exited'; status: number }
  | { kind: 'signaled'; signal: string }
  | { kind: 'not-started'; message: string }
  | { kind: 'timeout' }
  | { kind: 'aborted' }

interface RunSpec {
  command: string
  args: string[]
  cwd: string | undefined
  inheritOutput: boolean
  timeoutMs: number
  killGraceMs: number
  abort: AbortSignal | undefined
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function isNoSuchProcess(error: unknown): boolean {
  return error instanceof Error && 'code' in error && error.code === 'ESRCH'
}

function failure(reason: string): BreakLineResult {
  return { verdict: 'ERROR', reason }
}

function groupExists(group: number): boolean {
  try {
    process.kill(-group, 0)
    return true
  } catch (error) {
    return !isNoSuchProcess(error)
  }
}

function signalGroup(group: number, signal: NodeJS.Signals): void {
  if (group <= 1) return
  try {
    process.kill(-group, signal)
  } catch {}
}

async function waitForGroupToEnd(group: number, limitMs: number): Promise<boolean> {
  const deadline = Date.now() + limitMs
  while (groupExists(group)) {
    if (Date.now() >= deadline) return false
    await sleep(POLL_MS)
  }
  return true
}

async function terminateGroup(group: number, graceMs: number): Promise<void> {
  signalGroup(group, 'SIGTERM')
  if (await waitForGroupToEnd(group, graceMs)) return
  signalGroup(group, 'SIGKILL')
  await waitForGroupToEnd(group, KILL_WAIT_MS)
}

async function run(spec: RunSpec): Promise<Outcome> {
  if (spec.abort?.aborted === true) return { kind: 'aborted' }
  const output = spec.inheritOutput ? 'inherit' : 'ignore'
  let child: ChildProcess
  try {
    child = spawn(spec.command, spec.args, {
      cwd: spec.cwd,
      stdio: ['ignore', output, output],
      detached: true,
      shell: false,
    })
  } catch (error) {
    return { kind: 'not-started', message: errorMessage(error) }
  }
  const ended = new Promise<Outcome>((done) => {
    child.once('error', (error) => {
      done({ kind: 'not-started', message: error.message })
    })
    child.once('close', (status, signal) => {
      done(
        status === null
          ? { kind: 'signaled', signal: signal ?? 'an unknown signal' }
          : { kind: 'exited', status },
      )
    })
  })
  const group = child.pid
  if (group === undefined) return ended

  let timer: NodeJS.Timeout | undefined
  let onAbort: (() => void) | undefined
  const stopped = new Promise<Outcome>((done) => {
    timer = setTimeout(() => {
      done({ kind: 'timeout' })
    }, spec.timeoutMs)
    onAbort = () => {
      done({ kind: 'aborted' })
    }
    spec.abort?.addEventListener('abort', onAbort, { once: true })
  })
  const outcome = await Promise.race([ended, stopped])
  clearTimeout(timer)
  if (onAbort !== undefined) spec.abort?.removeEventListener('abort', onAbort)
  if (outcome.kind === 'timeout' || outcome.kind === 'aborted') {
    await terminateGroup(group, spec.killGraceMs)
  }
  return outcome
}

function restore(file: string, original: Buffer): string | undefined {
  try {
    writeFileSync(file, original)
    return readFileSync(file).equals(original)
      ? undefined
      : 'the file was not restored byte for byte'
  } catch (error) {
    return `could not restore the file, which may still hold the mutation: ${errorMessage(error)}`
  }
}

function announce(inheritOutput: boolean, label: string): void {
  if (inheritOutput) console.error(`break-line: ${label}`)
}

async function probe(options: BreakLineOptions): Promise<BreakLineResult> {
  if (process.platform === 'win32') {
    return failure('it needs POSIX process groups; run it under WSL')
  }
  const original = readFileSync(options.file)
  const text = original.toString('utf8')
  const at = options.find === '' ? -1 : text.indexOf(options.find)
  if (at === -1) return failure('snippet not found')
  if (text.indexOf(options.find, at + 1) !== -1) {
    return failure('snippet appears more than once; make it unique')
  }
  if (options.find === options.replace) return failure('the replacement equals the snippet')
  const mutated = text.slice(0, at) + options.replace + text.slice(at + options.find.length)

  const inheritOutput = options.inheritOutput === true
  const spec: RunSpec = {
    command: options.command,
    args: options.args,
    cwd: options.cwd,
    inheritOutput,
    timeoutMs: options.timeoutSeconds * 1000,
    killGraceMs: options.killGraceMs ?? KILL_GRACE_MS,
    abort: options.abort,
  }
  const limit = `${options.timeoutSeconds} s`
  const interruption = (): string => {
    const reason = options.abort?.reason
    return typeof reason === 'string' ? reason : 'an abort signal'
  }

  announce(inheritOutput, 'baseline run, without the mutation')
  const baseline = await run(spec)
  switch (baseline.kind) {
    case 'exited':
      if (baseline.status !== 0) {
        return failure(`the command fails without the mutation (exit ${baseline.status})`)
      }
      break
    case 'signaled':
      return failure(`the command fails without the mutation (signal ${baseline.signal})`)
    case 'not-started':
      return failure(`the command could not start: ${baseline.message}`)
    case 'timeout':
      return failure(`timed out after ${limit} (baseline run)`)
    case 'aborted':
      return failure(`interrupted by ${interruption()} (baseline run); the file was not touched`)
  }

  announce(inheritOutput, 'mutated run, with the mutation')
  let outcome: Outcome
  try {
    writeFileSync(options.file, mutated)
    outcome = await run(spec)
  } catch (error) {
    const problem = restore(options.file, original)
    return failure(
      problem === undefined ? errorMessage(error) : `${errorMessage(error)}; ${problem}`,
    )
  }
  const problem = restore(options.file, original)
  if (problem !== undefined) return failure(problem)

  switch (outcome.kind) {
    case 'exited':
      return outcome.status === 0
        ? { verdict: 'NOT CAUGHT', reason: 'the command passes without the mutation and with it' }
        : {
            verdict: 'CAUGHT',
            reason: `the command passes without the mutation and fails with it (exit ${outcome.status})`,
          }
    case 'signaled':
      return failure(
        `the command was killed by ${outcome.signal} (mutated run), which is not a test failing`,
      )
    case 'not-started':
      return failure(`the command could not start: ${outcome.message}`)
    case 'timeout':
      return failure(`timed out after ${limit} (mutated run)`)
    case 'aborted':
      return failure(`interrupted by ${interruption()} (mutated run); the file was restored`)
  }
}

export async function breakLine(options: BreakLineOptions): Promise<BreakLineResult> {
  try {
    return await probe(options)
  } catch (error) {
    return failure(errorMessage(error))
  }
}

const EXIT_CODES: Record<Verdict, number> = {
  CAUGHT: 0,
  'NOT CAUGHT': 1,
  ERROR: 2,
}

export function parseTimeout(text: string | undefined): number {
  if (text === undefined) return DEFAULT_TIMEOUT_SECONDS
  const seconds = /^\d+(?:\.\d+)?$/.test(text) ? Number(text) : Number.NaN
  if (!(seconds > 0 && seconds <= MAX_TIMEOUT_SECONDS)) {
    throw new Error(
      `--timeout must be a number of seconds, greater than 0 and at most ${MAX_TIMEOUT_SECONDS}; got ${JSON.stringify(text)}`,
    )
  }
  return seconds
}

const USAGE =
  'usage: node scripts/break-line.ts --file <path> --find <text> --replace <text> [--timeout <seconds>] -- <command> [args...]'

const HELP = `${USAGE}

Mutation probe. Replaces one exact snippet of <path>, runs the command, and puts the file back
byte for byte. The command runs twice, each run in its own process group:
  1. baseline run: on the file as it is. It must exit 0, or the result is ERROR and the file
     is never touched.
  2. mutated run: on the file with the snippet replaced. A failure is what you want to see.
The output of both runs is shown, each under a "break-line:" header on stderr. The command gets
no stdin.

Options:
  --file <path>        the file to mutate
  --find <text>        the exact snippet to replace; it must appear exactly once
  --replace <text>     the text to put in its place
  --timeout <seconds>  how long each of the two runs may take (default ${DEFAULT_TIMEOUT_SECONDS}; fractions allowed,
                       at most ${MAX_TIMEOUT_SECONDS}). A run that takes longer is killed with its process
                       group, the file is restored and the result is ERROR
  -h, --help           print this help
A value that starts with "-" must be written as --find=<value>.

The last line printed is the verdict, which says which run produced it. The exit code repeats it:
  CAUGHT      0    passed without the mutation and failed with it: a test guards the snippet
  NOT CAUGHT  1    passed both ways: nothing guards the snippet
  ERROR       2    no verdict: bad arguments, a file that cannot be read, a snippet that is
                   missing or ambiguous, a command that fails without the mutation, cannot start,
                   is killed by a signal or times out, or a file that could not be restored
  128 + N          interrupted by signal N (SIGINT 130, SIGTERM 143, SIGHUP 129): the command's
                   process group is killed and the file restored before the probe exits`

export async function main(argv: string[]): Promise<number> {
  try {
    return await cli(argv)
  } catch (error) {
    console.error(`ERROR: ${errorMessage(error)}`)
    return EXIT_CODES.ERROR
  }
}

async function cli(argv: string[]): Promise<number> {
  const separator = argv.indexOf('--')
  const usageError = (message?: string): number => {
    if (message !== undefined) console.error(message)
    console.error(USAGE)
    return EXIT_CODES.ERROR
  }
  let values: { file?: string; find?: string; replace?: string; timeout?: string; help?: boolean }
  try {
    ;({ values } = parseArgs({
      args: separator === -1 ? argv : argv.slice(0, separator),
      options: {
        file: { type: 'string' },
        find: { type: 'string' },
        replace: { type: 'string' },
        timeout: { type: 'string' },
        help: { type: 'boolean', short: 'h' },
      },
      strict: true,
    }))
  } catch (error) {
    return usageError(errorMessage(error))
  }
  if (values.help === true) {
    console.log(HELP)
    return 0
  }
  const [command, ...args] = separator === -1 ? [] : argv.slice(separator + 1)
  if (
    values.file === undefined ||
    values.find === undefined ||
    values.replace === undefined ||
    command === undefined
  ) {
    return usageError()
  }
  let timeoutSeconds: number
  try {
    timeoutSeconds = parseTimeout(values.timeout)
  } catch (error) {
    return usageError(errorMessage(error))
  }

  const abort = new AbortController()
  let received: NodeJS.Signals | undefined
  const listeners = INTERRUPT_SIGNALS.map((name) => {
    const listener = (): void => {
      received ??= name
      abort.abort(name)
    }
    process.on(name, listener)
    return { name, listener }
  })
  let result: BreakLineResult
  try {
    result = await breakLine({
      file: values.file,
      find: values.find,
      replace: values.replace,
      command,
      args,
      timeoutSeconds,
      inheritOutput: true,
      abort: abort.signal,
    })
  } finally {
    for (const { name, listener } of listeners) process.off(name, listener)
  }
  console.log(`${result.verdict}: ${result.reason}`)
  return received === undefined ? EXIT_CODES[result.verdict] : 128 + constants.signals[received]
}

const invoked = process.argv[1]
if (invoked !== undefined && pathToFileURL(resolve(invoked)).href === import.meta.url) {
  process.exit(await main(process.argv.slice(2)))
}
