import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vite-plus/test'
import {
  freePort,
  groupExists,
  runProcess,
  startProcess,
  stopAll,
  waitForWorker,
  type ManagedProcess,
} from './processes.ts'

const env = { ...process.env }

const PARENT_WITH_CHILD = `
  const { spawn } = require('node:child_process')
  const child = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore' })
  console.log(JSON.stringify({ parent: process.pid, child: child.pid }))
  setInterval(() => {}, 1000)
`

function alive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

async function until(done: () => boolean, limitMs = 5000): Promise<void> {
  const deadline = Date.now() + limitMs
  while (!done()) {
    if (Date.now() > deadline) throw new Error('gave up waiting')
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
}

async function startTree(): Promise<{ process: ManagedProcess; parent: number; child: number }> {
  const started = startProcess({
    command: process.execPath,
    args: ['-e', PARENT_WITH_CHILD],
    cwd: tmpdir(),
    env,
  })
  await until(() => started.output().includes('}'))
  const pids: unknown = JSON.parse(started.output())
  if (
    typeof pids !== 'object' ||
    pids === null ||
    !('parent' in pids) ||
    !('child' in pids) ||
    typeof pids.parent !== 'number' ||
    typeof pids.child !== 'number'
  ) {
    throw new Error('the test program printed no pids')
  }
  return { process: started, parent: pids.parent, child: pids.child }
}

afterEach(async () => {
  await stopAll()
})

describe('stopping a process', () => {
  it('ends the process and what it started, and leaves its group empty', async () => {
    const tree = await startTree()
    expect(alive(tree.parent)).toBe(true)
    expect(alive(tree.child)).toBe(true)
    await tree.process.stop()
    expect(alive(tree.parent)).toBe(false)
    expect(alive(tree.child)).toBe(false)
    expect(groupExists(tree.parent)).toBe(false)
    expect(await tree.process.exited).toBeNull()
  })

  it('kills a process that ignores SIGTERM once the grace period is over', async () => {
    const stubborn = startProcess({
      command: process.execPath,
      args: [
        '-e',
        "process.on('SIGTERM', () => {}); console.log('ready'); setInterval(() => {}, 1000)",
      ],
      cwd: tmpdir(),
      env,
      graceMs: 200,
    })
    await until(() => stubborn.output().includes('ready'))
    await stubborn.stop()
    expect(alive(stubborn.pid)).toBe(false)
  })

  it('stops every process that was started and still runs, through stopAll', async () => {
    const first = await startTree()
    const second = await startTree()
    await stopAll()
    expect([first.parent, first.child, second.parent, second.child].map(alive)).toEqual([
      false,
      false,
      false,
      false,
    ])
  })
})

describe('running a command', () => {
  it('gives its exit code and what it wrote to stdout and to stderr', async () => {
    const result = await runProcess({
      command: process.execPath,
      args: ['-e', "console.log('to stdout'); console.error('to stderr'); process.exit(3)"],
      cwd: tmpdir(),
      env,
    })
    expect(result.code).toBe(3)
    expect(result.output).toContain('to stdout')
    expect(result.output).toContain('to stderr')
  })

  it('stops what the command started when the command ends', async () => {
    const result = await runProcess({
      command: process.execPath,
      args: [
        '-e',
        "const { spawn } = require('node:child_process'); const child = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore' }); child.unref(); console.log(child.pid)",
      ],
      cwd: tmpdir(),
      env,
    })
    expect(alive(Number(result.output.trim()))).toBe(false)
  })

  it('throws for a command that cannot start', () => {
    expect(() =>
      startProcess({ command: '/nonexistent/hollware-conformance', args: [], cwd: tmpdir(), env }),
    ).toThrow('could not start /nonexistent/hollware-conformance')
  })

  it('writes the output to the log file when it is given one', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'hollware-conformance-test-'))
    try {
      const logFile = join(directory, 'run.log')
      const started = startProcess({
        command: process.execPath,
        args: ['-e', "console.log('line one'); console.error('line two')"],
        cwd: tmpdir(),
        env,
        logFile,
      })
      await started.exited
      expect(readFileSync(logFile, 'utf8').split('\n').sort()).toEqual(['', 'line one', 'line two'])
      expect(started.output()).toBe('')
    } finally {
      rmSync(directory, { recursive: true, force: true })
    }
  })
})

describe('freePort', () => {
  it('gives a port that can be listened on right away', async () => {
    const port = await freePort()
    const server = createServer()
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject)
      server.listen(port, '127.0.0.1', resolve)
    })
    await new Promise<void>((resolve) => server.close(() => resolve()))
    expect(port).toBeGreaterThan(1024)
  })
})

describe('waiting for the Worker', () => {
  async function worker(): Promise<{
    port: number
    seen: (string | undefined)[]
    close: () => void
  }> {
    const seen: (string | undefined)[] = []
    const server = createServer((incoming, response) => {
      seen.push(incoming.headers.host)
      const ready =
        incoming.url === '/health' &&
        incoming.headers.host === 'hollware.test:1234' &&
        seen.length > 2
      response.writeHead(ready ? 200 : 503)
      response.end()
    })
    const port = await freePort()
    await new Promise<void>((resolve) => server.listen(port, '127.0.0.1', resolve))
    return {
      port,
      seen,
      close: () => {
        server.close()
        server.closeAllConnections()
      },
    }
  }

  const sleeper = () =>
    startProcess({
      command: process.execPath,
      args: ['-e', 'setInterval(() => {}, 1000)'],
      cwd: tmpdir(),
      env,
    })

  it('polls GET /health with the Host of the public URL until it answers 200', async () => {
    const stand = await worker()
    try {
      await waitForWorker({
        port: stand.port,
        host: 'hollware.test:1234',
        process: sleeper(),
        timeoutMs: 5000,
      })
      expect(stand.seen).toEqual(['hollware.test:1234', 'hollware.test:1234', 'hollware.test:1234'])
    } finally {
      stand.close()
    }
  })

  it('gives up after its limit when the Worker never answers 200', async () => {
    const stand = await worker()
    try {
      await expect(
        waitForWorker({
          port: stand.port,
          host: 'another.test',
          process: sleeper(),
          timeoutMs: 700,
        }),
      ).rejects.toThrow('the Worker did not answer GET /health within 0.7 s')
    } finally {
      stand.close()
    }
  })

  it('gives up at once when the process has ended', async () => {
    const ended = startProcess({ command: process.execPath, args: ['-e', ''], cwd: tmpdir(), env })
    await ended.exited
    await expect(
      waitForWorker({
        port: await freePort(),
        host: 'hollware.test',
        process: ended,
        timeoutMs: 5000,
      }),
    ).rejects.toThrow('wrangler dev stopped before the Worker answered')
  })
})
