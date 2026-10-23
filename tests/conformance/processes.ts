import { spawn } from 'node:child_process'
import { closeSync, openSync } from 'node:fs'
import { request } from 'node:http'
import { createServer } from 'node:net'
import { setTimeout as sleep } from 'node:timers/promises'

const GRACE_MS = 5000
const KILL_WAIT_MS = 5000
const POLL_MS = 25

export interface ProcessOptions {
  readonly command: string
  readonly args: readonly string[]
  readonly cwd: string
  readonly env: NodeJS.ProcessEnv
  readonly logFile?: string
  readonly graceMs?: number
}

export interface ManagedProcess {
  readonly pid: number
  readonly exited: Promise<number | null>
  hasExited(): boolean
  output(): string
  stop(): Promise<void>
}

const running = new Set<ManagedProcess>()

function noSuchProcess(error: unknown): boolean {
  return error instanceof Error && 'code' in error && error.code === 'ESRCH'
}

export function groupExists(group: number): boolean {
  try {
    process.kill(-group, 0)
    return true
  } catch (error) {
    return !noSuchProcess(error)
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

export function startProcess(options: ProcessOptions): ManagedProcess {
  const logDescriptor = options.logFile === undefined ? undefined : openSync(options.logFile, 'a')
  const child = spawn(options.command, [...options.args], {
    cwd: options.cwd,
    env: options.env,
    stdio:
      logDescriptor === undefined
        ? ['ignore', 'pipe', 'pipe']
        : ['ignore', logDescriptor, logDescriptor],
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

export async function stopAll(): Promise<void> {
  await Promise.all([...running].map((managed) => managed.stop()))
}

export async function runProcess(
  options: Omit<ProcessOptions, 'logFile'>,
): Promise<{ code: number | null; output: string }> {
  const child = startProcess(options)
  try {
    const code = await child.exited
    return { code, output: child.output() }
  } finally {
    await child.stop()
  }
}

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
