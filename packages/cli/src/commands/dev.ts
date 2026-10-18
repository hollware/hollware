import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { parseFlags } from '../args.ts'
import type { DevChild, DevHost } from '../dev-host.ts'
import { CliError, UsageError } from '../errors.ts'
import type { Io } from '../io.ts'
import { publicUrlOf } from '../public-url.ts'
import { findBin } from '../wrangler.ts'

export const DEV_USAGE = [
  'Usage: hollware dev [--url <url>] [--timeout <seconds>] [--json]',
  '       hollware dev --detach [--url <url>] [--timeout <seconds>] [--json]',
  '       hollware dev --stop [--json]',
  '',
  'Starts the project\'s local server, the way its "dev" script does (the project\'s own vp dev),',
  'waits until GET <url>/health answers, and prints "Hollware is ready at <url>". It stays in the',
  'foreground until SIGINT or SIGTERM, then stops the server and everything it started.',
  'With --detach it starts the server in the background, writes its process id and URL to',
  `.wrangler/hollware-dev.json, prints the ready line and exits 0. "hollware dev --stop" stops what`,
  'that file names.',
  'Once "hollware deploy" has written the public URL into wrangler.jsonc, the local server still',
  'answers at localhost: hollware dev sets HOLLWARE_PUBLIC_URL in .dev.vars, which wrangler reads',
  'in development instead of the vars of wrangler.jsonc, and leaves the rest of that file alone.',
  '',
  'Options:',
  '  --url <url>          Where the server listens (default: HOLLWARE_PUBLIC_URL of wrangler.jsonc',
  '                       when it is a localhost URL, else http://localhost:5199)',
  '  --timeout <seconds>  How long to wait for /health, 1 to 600 (default: 60)',
  '  --detach             Start it in the background and exit',
  '  --stop               Stop the server that --detach started',
  '  --json               One JSON object on stdout instead of the line',
  '  --help               Show this help',
].join('\n')

/** The file that names the server `--detach` started, relative to the project. */
export const DEV_STATE_FILE = join('.wrangler', 'hollware-dev.json')

const DEFAULT_URL = 'http://localhost:5199'
const POLL_MS = 250
const GRACE_MS = 5000

interface DevState {
  readonly pid: number
  readonly url: string
  readonly startedAt: string
}

export async function dev(argv: readonly string[], io: Io): Promise<number> {
  const { values } = parseFlags({
    args: [...argv],
    allowPositionals: false,
    options: {
      url: { type: 'string' },
      timeout: { type: 'string' },
      detach: { type: 'boolean' },
      stop: { type: 'boolean' },
      json: { type: 'boolean' },
      help: { type: 'boolean' },
    },
  })
  if (values.help === true) {
    io.out(DEV_USAGE)
    return 0
  }
  const host = io.dev
  if (host === undefined) throw new CliError('this environment cannot run a local server.')
  const json = values.json === true
  if (values.stop === true) {
    if (values.detach === true || values.url !== undefined || values.timeout !== undefined) {
      throw new UsageError('--stop goes alone: it stops what --detach started.')
    }
    return stop(io, host, json)
  }
  const timeout = timeoutOf(values.timeout)
  const configured = publicUrlOf(io.cwd, undefined)
  const url =
    values.url !== undefined
      ? (publicUrlOf(io.cwd, values.url) ?? DEFAULT_URL)
      : configured !== undefined && isLoopback(configured)
        ? configured
        : DEFAULT_URL
  // The Worker answers only the Host of HOLLWARE_PUBLIC_URL: locally, that is this URL.
  const devVars = join(io.cwd, '.dev.vars')
  const before = existsSync(devVars) ? readFileSync(devVars, 'utf8') : undefined
  const after = withDevPublicUrl(before, url, configured)
  if (after !== before && after !== undefined) {
    writeFileSync(devVars, after)
    if (!json) io.out(`Set HOLLWARE_PUBLIC_URL to ${url} in .dev.vars, for the local server.`)
  }
  const bin = findBin(io.cwd, 'vp')
  if (bin === undefined) {
    throw new CliError(
      `vp is not installed in ${io.cwd} or any directory above it. Install the dependencies of the project (for example "pnpm install") and run hollware dev from the project directory.`,
    )
  }
  const detach = values.detach === true
  const state = readState(io.cwd)
  if (state !== undefined && host.isAlive(state.pid)) {
    throw new CliError(
      `a server started by --detach runs already (process ${state.pid}, ${state.url}). Stop it with "hollware dev --stop".`,
    )
  }

  const child = host.spawn(bin, ['dev'], io.cwd, { detached: detach })
  let interrupted = false
  let signalled: () => void = () => undefined
  const asked = new Promise<'signal'>((resolve) => {
    signalled = () => resolve('signal')
  })
  const off = host.onSignal(() => {
    interrupted = true
    signalled()
  })
  try {
    const ready = await waitUntilHealthy(host, child, url, timeout, () => interrupted)
    if (ready !== 'ready') {
      await terminate(host, child)
      if (ready === 'interrupted') return 0
      throw new CliError(
        ready === 'exited'
          ? `the dev server stopped before it was ready.${detail(child)}`
          : `the dev server did not answer ${url}/health within ${timeout} seconds.${detail(child)}`,
      )
    }
    announce(io, json, { ready: true, url, pid: child.pid, detached: detach })
    if (detach) {
      const file = join(io.cwd, DEV_STATE_FILE)
      mkdirSync(join(io.cwd, '.wrangler'), { recursive: true })
      const record: DevState = { pid: child.pid, url, startedAt: io.now().toISOString() }
      writeFileSync(file, `${JSON.stringify(record, null, 2)}\n`)
      return 0
    }
    // The foreground: until a signal, or until the server stops by itself.
    const settled = await Promise.race([asked, child.exited.then(() => 'exited' as const)])
    if (settled === 'exited') {
      throw new CliError(`the dev server stopped by itself.${detail(child)}`)
    }
    await terminate(host, child)
    return 0
  } finally {
    off()
  }
}

/** Whether a URL is this machine's. */
function isLoopback(url: string): boolean {
  const { hostname } = new URL(url)
  return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '[::1]'
}

const DEV_PUBLIC_URL = /^HOLLWARE_PUBLIC_URL=.*$/m

/**
 * `.dev.vars` (or `undefined`, for none) with HOLLWARE_PUBLIC_URL set to `url` whenever
 * wrangler.jsonc names another one (`configured`) or the file names one already, and every other
 * line as it was. A project whose wrangler.jsonc says `url`, or names none, keeps no file.
 */
export function withDevPublicUrl(
  text: string | undefined,
  url: string,
  configured: string | undefined,
): string | undefined {
  const line = `HOLLWARE_PUBLIC_URL=${url}`
  if (text !== undefined && DEV_PUBLIC_URL.test(text)) return text.replace(DEV_PUBLIC_URL, line)
  if (configured === undefined || url === configured) return text
  if (text === undefined || text === '') return `${line}\n`
  return `${text}${text.endsWith('\n') ? '' : '\n'}${line}\n`
}

async function stop(io: Io, host: DevHost, json: boolean): Promise<number> {
  const state = readState(io.cwd)
  if (state === undefined) {
    if (json) io.out(JSON.stringify({ stopped: false }))
    else io.out(`No detached server to stop: ${DEV_STATE_FILE} does not exist.`)
    return 0
  }
  const wasAlive = host.isAlive(state.pid)
  if (wasAlive) {
    host.killGroup(state.pid, 'SIGTERM')
    const until = GRACE_MS / POLL_MS
    for (let waited = 0; host.isAlive(state.pid) && waited < until; waited += 1) {
      await host.sleep(POLL_MS)
    }
    host.killGroup(state.pid, 'SIGKILL')
  }
  rmSync(join(io.cwd, DEV_STATE_FILE), { force: true })
  if (json) io.out(JSON.stringify({ stopped: wasAlive, pid: state.pid, url: state.url }))
  else {
    io.out(
      wasAlive
        ? `Stopped the server at ${state.url} (process ${state.pid}).`
        : `The server at ${state.url} (process ${state.pid}) was not running; removed ${DEV_STATE_FILE}.`,
    )
  }
  return 0
}

function announce(
  io: Io,
  json: boolean,
  what: { ready: true; url: string; pid: number; detached: boolean },
): void {
  io.out(json ? JSON.stringify(what) : `Hollware is ready at ${what.url}`)
}

function timeoutOf(value: string | undefined): number {
  if (value === undefined) return 60
  const seconds = /^\d+$/.test(value) ? Number(value) : Number.NaN
  if (!(seconds >= 1 && seconds <= 600)) {
    throw new UsageError(`--timeout is a whole number of seconds from 1 to 600, not "${value}".`)
  }
  return seconds
}

/** Polls /health until it answers, the server ends, a signal comes or the time is up. */
async function waitUntilHealthy(
  host: DevHost,
  child: DevChild,
  url: string,
  seconds: number,
  interrupted: () => boolean,
): Promise<'ready' | 'exited' | 'timeout' | 'interrupted'> {
  let ended = false
  void child.exited.then(() => {
    ended = true
  })
  for (let waited = 0; waited <= seconds * 1000; waited += POLL_MS) {
    if (interrupted()) return 'interrupted'
    if (ended) return 'exited'
    if (await host.healthy(url)) return 'ready'
    await host.sleep(POLL_MS)
  }
  return 'timeout'
}

/** Stops the server: SIGTERM to its group, SIGKILL when it has not ended after a grace period. */
async function terminate(host: DevHost, child: DevChild): Promise<void> {
  host.killGroup(child.pid, 'SIGTERM')
  // The grace timer is cleared when the server ends first: it would hold the process open.
  const clear = new AbortController()
  const ended = await Promise.race([
    child.exited.then(() => true),
    host.sleep(GRACE_MS, clear.signal).then(() => false),
  ])
  clear.abort()
  if (!ended) {
    host.killGroup(child.pid, 'SIGKILL')
    await child.exited
  }
  // The leader is gone. What it started is in the same group, which SIGTERM reached already; one
  // that ignored it gets a moment, then SIGKILL (nothing happens when the group is empty).
  await host.sleep(POLL_MS)
  host.killGroup(child.pid, 'SIGKILL')
}

function detail(child: DevChild): string {
  const tail = child.tail().trim()
  return tail === '' ? '' : `\n${tail}`
}

function readState(cwd: string): DevState | undefined {
  const file = join(cwd, DEV_STATE_FILE)
  if (!existsSync(file)) return undefined
  try {
    const parsed: unknown = JSON.parse(readFileSync(file, 'utf8'))
    if (
      typeof parsed === 'object' &&
      parsed !== null &&
      'pid' in parsed &&
      'url' in parsed &&
      typeof parsed.pid === 'number' &&
      Number.isInteger(parsed.pid) &&
      parsed.pid > 1 &&
      typeof parsed.url === 'string'
    ) {
      return {
        pid: parsed.pid,
        url: parsed.url,
        startedAt:
          'startedAt' in parsed && typeof parsed.startedAt === 'string' ? parsed.startedAt : '',
      }
    }
  } catch {
    // Not JSON: treated as if it was not there, and replaced by the next --detach.
  }
  return undefined
}
