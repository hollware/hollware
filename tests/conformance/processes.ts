import { spawn } from 'node:child_process'
import { closeSync, openSync } from 'node:fs'
import { request } from 'node:http'
import { createServer } from 'node:net'
import { setTimeout as sleep } from 'node:timers/promises'

/**
 * The processes of a conformance run: `wrangler dev`, the CLI of Hollware and the suite. Each
 * one leads a process group of its own, so that stopping it reaches what it started (wrangler
 * starts workerd), and nothing else. POSIX only, like `scripts/break-line.ts`.
 */

/** How long a stopped process has to end after SIGTERM before it gets SIGKILL, by default. */
const GRACE_MS = 5000
/** How long to wait for a process group to disappear after SIGKILL. */
const KILL_WAIT_MS = 5000
const POLL_MS = 25

export interface ProcessOptions {
  readonly command: string
  readonly args: readonly string[]
  readonly cwd: string
  readonly env: NodeJS.ProcessEnv
  /** Where stdout and stderr go. Without it they are kept in memory, for `output()`. */
  readonly logFile?: string
  /** How long `stop()` waits after SIGTERM before it sends SIGKILL. */
  readonly graceMs?: number
}

export interface ManagedProcess {
  readonly pid: number
  /** Resolves when the process has ended: its exit code, or `null` when a signal ended it. */
  readonly exited: Promise<number | null>
  /** Whether it has ended. */
  hasExited(): boolean
  /** What it wrote so far, when there is no log file. */
  output(): string
  /** SIGTERM to its group, SIGKILL when something outlives the grace period. Safe to repeat. */
  stop(): Promise<void>
}

const running = new Set<ManagedProcess>()

function noSuchProcess(error: unknown): boolean {
  return error instanceof Error && 'code' in error && error.code === 'ESRCH'
}

/** True while any process of the group is left, a zombie nobody reaped yet included. */
export function groupExists(group: number): boolean {
  try {
    process.kill(-group, 0)
    return true
  } catch (error) {
    return !noSuchProcess(error)
  }
}

function signalGroup(group: number, signal: NodeJS.Signals): void {
  // `group` is a child pid: 0 or 1 would reach this process group or every process.
  if (group <= 1) return
  try {
    process.kill(-group, signal)
  } catch {
    // A group that is gone is the goal; one we may not signal cannot be helped.
  }
}

async function waitForGroupToEnd(group: number, limitMs: number): Promise<boolean> {
  const deadline = Date.now() + limitMs
  while (groupExists(group)) {
    if (Date.now() >= deadline) return false
    await sleep(POLL_MS)
  }
  return true
}

/** Starts a process that leads a group of its own. Throws when it cannot start. */
export function startProcess(options: ProcessOptions): ManagedProcess {
  const logDescriptor = options.logFile === undefined ? undefined : openSync(options.logFile, 'a')
  const child = spawn(options.command, [...options.args], {
    cwd: options.cwd,
    env: options.env,
    stdio:
      logDescriptor === undefined
        ? ['ignore', 'pipe', 'pipe']
        : ['ignore', logDescriptor, logDescriptor],
    // The child leads a new process group, so one signal reaches it and what it started.
    detached: true,
    shell: false,
  })
  if (logDescriptor !== undefined) closeSync(logDescriptor)

  let failure: Error | undefined
  let ended = false
  const exited = new Promise<number | null>((resolve, reject) => {
    child.once('error', (error) => {
      failure = error
      reject(error)
    })
    child.once('close', (code) => {
      ended = true
      resolve(code)
    })
  })
  // A process that never started rejects `exited`; nobody else would handle it.
  exited.catch(() => {})
  const pid = child.pid
  if (pid === undefined) {
    throw new Error(`could not start ${options.command}: ${failure?.message ?? 'no process id'}`)
  }

  let written = ''
  child.stdout?.setEncoding('utf8')
  child.stderr?.setEncoding('utf8')
  child.stdout?.on('data', (chunk: string) => {
    written += chunk
  })
  child.stderr?.on('data', (chunk: string) => {
    written += chunk
  })

  let stopping: Promise<void> | undefined
  const managed: ManagedProcess = {
    pid,
    exited,
    hasExited: () => ended,
    output: () => written,
    stop: () => {
      stopping ??= (async () => {
        signalGroup(pid, 'SIGTERM')
        if (!(await waitForGroupToEnd(pid, options.graceMs ?? GRACE_MS))) {
          signalGroup(pid, 'SIGKILL')
          await waitForGroupToEnd(pid, KILL_WAIT_MS)
        }
        running.delete(managed)
      })()
      return stopping
    },
  }
  running.add(managed)
  return managed
}

/** Stops every process this module started that is still running. */
export async function stopAll(): Promise<void> {
  await Promise.all([...running].map((managed) => managed.stop()))
}

/** Runs a command to the end, and gives its exit code and what it wrote. */
export async function runProcess(
  options: Omit<ProcessOptions, 'logFile'>,
): Promise<{ code: number | null; output: string }> {
  const child = startProcess(options)
  try {
    const code = await child.exited
    return { code, output: child.output() }
  } finally {
    // The leader is gone; whatever it started must not outlive it.
    await child.stop()
  }
}

/** A port nobody listens on, on the loopback address. */
export function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer()
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      if (address === null || typeof address === 'string') {
        reject(new Error('the probe server has no TCP address'))
        return
      }
      server.close(() => {
        resolve(address.port)
      })
    })
  })
}

/** One `GET /health` of the Worker with the Host it answers, and the status it gives. */
function probe(port: number, host: string): Promise<number | undefined> {
  return new Promise((resolve) => {
    const call = request(
      { host: '127.0.0.1', port, path: '/health', headers: { host } },
      (answer) => {
        answer.resume()
        resolve(answer.statusCode)
      },
    )
    call.once('error', () => {
      resolve(undefined)
    })
    call.setTimeout(2000, () => {
      call.destroy()
    })
    call.end()
  })
}

/**
 * Waits until the Worker answers `GET /health` with 200 to the Host of its public URL. It gives
 * up when the process ends first, or after `timeoutMs`.
 */
export async function waitForWorker(options: {
  readonly port: number
  readonly host: string
  readonly process: ManagedProcess
  readonly timeoutMs: number
}): Promise<void> {
  const deadline = Date.now() + options.timeoutMs
  while (Date.now() < deadline) {
    if (options.process.hasExited()) {
      throw new Error('wrangler dev stopped before the Worker answered')
    }
    if ((await probe(options.port, options.host)) === 200) return
    await sleep(250)
  }
  throw new Error(`the Worker did not answer GET /health within ${options.timeoutMs / 1000} s`)
}
