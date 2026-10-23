import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vite-plus/test'

import type { DevChild, DevExit, DevHost } from '../src/dev-host.ts'
import { createIo } from './support/io.ts'
import { main } from '../src/index.ts'
import { tempDirs, wranglerWithPublicUrl } from './support/project.ts'

const temp = tempDirs()

interface Spawned {
  bin: string
  args: readonly string[]
  cwd: string
  detached: boolean
}

function fakeHost(
  options: {
    healthyAfter?: number
    printed?: string
    ignoresTerm?: boolean
    exitsAt?: number
    alive?: Set<number>
  } = {},
) {
  const spawned: Spawned[] = []
  const signals: { pid: number; signal: string }[] = []
  const polled: string[] = []
  const alive = options.alive ?? new Set<number>()
  let slept = 0
  let checks = 0
  let end: (exit: DevExit) => void = () => undefined
  let listener: (() => void) | undefined
  let listening = 0
  const child: DevChild = {
    pid: 4242,
    exited: new Promise<DevExit>((resolve) => {
      end = resolve
    }),
    tail: () => options.printed ?? '',
  }
  const host: DevHost = {
    spawn: (bin, args, cwd, { detached }) => {
      spawned.push({ bin, args, cwd, detached })
      alive.add(4242)
      return child
    },
    killGroup: (pid, signal) => {
      signals.push({ pid, signal })
      const dies = signal === 'SIGKILL' || options.ignoresTerm !== true
      if (dies) {
        alive.delete(pid)
        end({ code: null, signal })
      }
    },
    isAlive: (pid) => alive.has(pid),
    onSignal: (callback) => {
      listener = callback
      listening += 1
      return () => {
        listener = undefined
        listening -= 1
      }
    },
    healthy: (url) => {
      polled.push(url)
      checks += 1
      return Promise.resolve(checks > (options.healthyAfter ?? 0))
    },
    sleep: (ms) => {
      slept += ms
      if (options.exitsAt !== undefined && slept >= options.exitsAt) {
        alive.delete(4242)
        end({ code: 1, signal: null })
      }
      return new Promise((resolve) => setTimeout(resolve, 0))
    },
  }
  return {
    host,
    spawned,
    signals,
    alive,
    signal: () => listener?.(),
    listening: () => listening,
    slept: () => slept,
    checks: () => checks,
    polled,
  }
}

async function printed(out: string[]): Promise<void> {
  for (let tries = 0; out.length === 0; tries += 1) {
    if (tries > 500) throw new Error('the command printed nothing')
    await new Promise((resolve) => setTimeout(resolve, 2))
  }
}

function project(withVp = true, publicUrl = 'http://localhost:5199') {
  return temp.make({
    'wrangler.jsonc': wranglerWithPublicUrl(publicUrl),
    ...(withVp ? { 'node_modules/.bin/vp': '#!/bin/sh\n' } : {}),
  })
}

describe('hollware dev', () => {
  it('stays on localhost once deployed, and writes nothing', async () => {
    const cwd = project(true, 'https://cms.example.com')
    const machine = fakeHost()
    const { io, out } = createIo({ cwd, dev: machine.host })

    const running = main(['dev'], io)
    await printed(out)
    await new Promise((resolve) => setTimeout(resolve, 5))
    machine.signal()
    await running

    expect(machine.polled[0]).toMatch(/^http:\/\/localhost:5199/)
    expect(existsSync(join(cwd, '.dev.vars'))).toBe(false)
    expect(out).toEqual(['Hollware is ready at http://localhost:5199'])
  })

  it('prints the ready line once /health answers, from the vp of the project', async () => {
    const cwd = project()
    const machine = fakeHost({ healthyAfter: 3 })
    const { io, out, err } = createIo({ cwd, dev: machine.host })

    const running = main(['dev'], io)
    await printed(out)
    const readyBeforeSignal = [...out]
    machine.signal()
    const code = await running

    expect(machine.spawned).toEqual([
      { bin: join(cwd, 'node_modules/.bin/vp'), args: ['dev'], cwd, detached: false },
    ])
    expect(machine.checks()).toBe(4)
    expect(readyBeforeSignal).toEqual(['Hollware is ready at http://localhost:5199'])
    expect([code, out, err]).toEqual([0, ['Hollware is ready at http://localhost:5199'], []])
  })

  it('stops the server and its group on a signal, then exits 0 and stops listening', async () => {
    const machine = fakeHost()
    const { io, out } = createIo({ cwd: project(), dev: machine.host })

    const running = main(['dev'], io)
    await printed(out)
    machine.signal()
    const code = await running

    expect(code).toBe(0)
    expect(machine.signals).toEqual([
      { pid: 4242, signal: 'SIGTERM' },
      { pid: 4242, signal: 'SIGKILL' },
    ])
    expect(machine.listening()).toBe(0)
  })

  it('kills a server that ignores SIGTERM, after the grace period', async () => {
    const machine = fakeHost({ ignoresTerm: true })
    const { io, out } = createIo({ cwd: project(), dev: machine.host })

    const running = main(['dev'], io)
    await printed(out)
    machine.signal()
    const code = await running

    expect(code).toBe(0)
    expect(machine.signals.map((sent) => sent.signal)).toEqual(['SIGTERM', 'SIGKILL', 'SIGKILL'])
  })

  it('says what the server printed when it stops before it is ready', async () => {
    const machine = fakeHost({
      healthyAfter: 1000,
      exitsAt: 500,
      printed: 'Error: port 5199 is in use\n',
    })
    const { io, out, err } = createIo({ cwd: project(), dev: machine.host })

    const code = await main(['dev'], io)

    expect([code, out]).toEqual([1, []])
    expect(err).toEqual([
      'hollware dev: the dev server stopped before it was ready.\nError: port 5199 is in use',
    ])
  })

  it('gives up after --timeout seconds, and stops what it started', async () => {
    const machine = fakeHost({ healthyAfter: 1_000_000 })
    const { io, out, err } = createIo({ cwd: project(), dev: machine.host })

    const code = await main(['dev', '--timeout', '2'], io)

    expect([code, out]).toEqual([1, []])
    expect(err).toEqual([
      'hollware dev: the dev server did not answer http://localhost:5199/health within 2 seconds.',
    ])
    expect(machine.signals[0]).toEqual({ pid: 4242, signal: 'SIGTERM' })
    expect(machine.slept()).toBeGreaterThanOrEqual(2000)
  })

  it('prints one JSON object with --json', async () => {
    const machine = fakeHost()
    const { io, out } = createIo({ cwd: project(), dev: machine.host })

    const running = main(['dev', '--json', '--url', 'http://localhost:6000'], io)
    await printed(out)
    machine.signal()
    await running

    expect(out.map((line) => JSON.parse(line))).toEqual([
      { ready: true, url: 'http://localhost:6000', pid: 4242, detached: false },
    ])
  })

  it('needs the vp of the project, never another', async () => {
    const machine = fakeHost()
    const { io, err } = createIo({ cwd: project(false), dev: machine.host })

    const code = await main(['dev'], io)

    expect(code).toBe(1)
    expect(err[0]).toMatch(/^hollware dev: vp is not installed in .* or any directory above it\./)
    expect(machine.spawned).toEqual([])
  })
})

describe('hollware dev --detach and --stop', () => {
  it('writes the state file and leaves the server running', async () => {
    const cwd = project()
    const machine = fakeHost()
    const { io, out } = createIo({ cwd, dev: machine.host })

    const code = await main(['dev', '--detach'], io)

    expect(code).toBe(0)
    expect(out).toEqual(['Hollware is ready at http://localhost:5199'])
    expect(machine.spawned[0]?.detached).toBe(true)
    expect(machine.signals).toEqual([])
    expect(JSON.parse(readFileSync(join(cwd, '.wrangler/hollware-dev.json'), 'utf8'))).toEqual({
      pid: 4242,
      url: 'http://localhost:5199',
      startedAt: '2026-10-12T12:00:00.000Z',
    })
    expect(machine.listening()).toBe(0)
  })

  it('refuses a second detached server while the first runs', async () => {
    const cwd = project()
    const machine = fakeHost()
    await main(['dev', '--detach'], createIo({ cwd, dev: machine.host }).io)
    const second = createIo({ cwd, dev: machine.host })

    const code = await main(['dev', '--detach'], second.io)

    expect(code).toBe(1)
    expect(second.err).toEqual([
      'hollware dev: a server started by --detach runs already (process 4242, http://localhost:5199). Stop it with "hollware dev --stop".',
    ])
    expect(machine.spawned).toHaveLength(1)
  })

  it('stops what the file names, and removes the file', async () => {
    const cwd = project()
    const machine = fakeHost()
    await main(['dev', '--detach', '--json'], createIo({ cwd, dev: machine.host }).io)
    const stopping = createIo({ cwd, dev: machine.host })

    const code = await main(['dev', '--stop'], stopping.io)

    expect(code).toBe(0)
    expect(machine.signals).toEqual([
      { pid: 4242, signal: 'SIGTERM' },
      { pid: 4242, signal: 'SIGKILL' },
    ])
    expect(stopping.out).toEqual(['Stopped the server at http://localhost:5199 (process 4242).'])
    expect(existsSync(join(cwd, '.wrangler/hollware-dev.json'))).toBe(false)
  })

  it('says so, and signals nothing, when the server is gone or there is no file', async () => {
    const cwd = project()
    const machine = fakeHost()
    const none = createIo({ cwd, dev: machine.host })
    await main(['dev', '--stop'], none.io)
    await main(['dev', '--detach'], createIo({ cwd, dev: machine.host }).io)
    machine.alive.delete(4242)
    const gone = createIo({ cwd, dev: machine.host })

    const code = await main(['dev', '--stop', '--json'], gone.io)

    expect(none.out).toEqual([
      'No detached server to stop: .wrangler/hollware-dev.json does not exist.',
    ])
    expect(code).toBe(0)
    expect(machine.signals).toEqual([])
    expect(gone.out.map((line) => JSON.parse(line))).toEqual([
      { stopped: false, pid: 4242, url: 'http://localhost:5199' },
    ])
    expect(existsSync(join(cwd, '.wrangler/hollware-dev.json'))).toBe(false)
  })
})
