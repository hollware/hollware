// Fails when:
// - "leaves no process behind after SIGTERM": the real host (`processDevHost` of src/index.ts)
//   stops starting the server as the leader of a group of its own, or signals only its leader, so
//   what the server started (here a `sleep`) outlives `hollware dev`, or the exit code is not 0.
// - "--detach leaves the server up, and --stop leaves nothing": the detached server dies with the
//   command, or --stop leaves the server, what it started or the state file.
// Real processes, a real HTTP server and real signals: a fake `vp` of the project, which is the
// one thing that is not ours (the real one starts Vite and workerd, which this test does not need).
import { spawn } from 'node:child_process'
import { chmodSync, existsSync, readFileSync } from 'node:fs'
import { createServer } from 'node:net'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vite-plus/test'

import { tempDirs } from './support/project.ts'

const temp = tempDirs()
const ENTRY = fileURLToPath(new URL('../src/index.ts', import.meta.url))

const SERVER = `
import { createServer } from 'node:http'
createServer((request, response) => {
  response.statusCode = request.url === '/health' ? 200 : 404
  response.end('{"ok":true}')
}).listen(Number(process.env.PORT), '127.0.0.1')
`

/** A project whose vp starts a server on PORT and, beside it, a long `sleep`. */
function project() {
  const cwd = temp.make({
    'node_modules/.bin/vp': `#!/bin/sh
sleep 300 &
echo $! > "$PWD/grandchild.pid"
exec node "$PWD/server.mjs"
`,
    'server.mjs': SERVER,
  })
  chmodSync(join(cwd, 'node_modules/.bin/vp'), 0o755)
  return cwd
}

async function freePort(): Promise<number> {
  const server = createServer()
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  await new Promise((resolve) => server.close(resolve))
  if (address === null || typeof address === 'string') throw new Error('no port')
  return address.port
}

function alive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

async function until(condition: () => boolean | Promise<boolean>, what: string): Promise<void> {
  for (let tries = 0; tries < 100; tries += 1) {
    if (await condition()) return
    await new Promise((resolve) => setTimeout(resolve, 100))
  }
  throw new Error(`timed out waiting for ${what}`)
}

const healthy = (port: number) =>
  fetch(`http://127.0.0.1:${port}/health`).then(
    (response) => response.status === 200,
    () => false,
  )

function cli(cwd: string, port: number, args: string[]) {
  const child = spawn(
    process.execPath,
    ['--no-warnings', ENTRY, 'dev', '--url', `http://127.0.0.1:${port}`, ...args],
    { cwd, env: { ...process.env, PORT: String(port) }, stdio: ['ignore', 'pipe', 'pipe'] },
  )
  let stdout = ''
  child.stdout.setEncoding('utf8')
  child.stdout.on('data', (chunk: string) => {
    stdout += chunk
  })
  const exited = new Promise<number | null>((resolve) => child.on('close', resolve))
  return { child, exited, stdout: () => stdout }
}

describe('hollware dev, with real processes', () => {
  it('leaves no process behind after SIGTERM', async () => {
    const cwd = project()
    const port = await freePort()
    const running = cli(cwd, port, [])

    await until(() => running.stdout().includes('Hollware is ready'), 'the ready line')
    const grandchild = Number(readFileSync(join(cwd, 'grandchild.pid'), 'utf8'))
    expect(alive(grandchild)).toBe(true)
    expect(await healthy(port)).toBe(true)
    running.child.kill('SIGTERM')
    const code = await running.exited

    expect(code).toBe(0)
    expect(running.stdout()).toBe(`Hollware is ready at http://127.0.0.1:${port}\n`)
    await until(() => !alive(grandchild), 'the sleep to end')
    expect(await healthy(port)).toBe(false)
  })

  it('--detach leaves the server up, and --stop leaves nothing', async () => {
    const cwd = project()
    const port = await freePort()
    const started = cli(cwd, port, ['--detach'])

    const code = await started.exited
    const state: { pid: number; url: string } = JSON.parse(
      readFileSync(join(cwd, '.wrangler/hollware-dev.json'), 'utf8'),
    )
    const grandchild = Number(readFileSync(join(cwd, 'grandchild.pid'), 'utf8'))

    expect(code).toBe(0)
    expect(started.stdout()).toBe(`Hollware is ready at http://127.0.0.1:${port}\n`)
    expect(state.url).toBe(`http://127.0.0.1:${port}`)
    expect(alive(state.pid)).toBe(true)
    expect(await healthy(port)).toBe(true)

    // --stop goes alone: it takes no --url, so it does not go through cli().
    const bare = spawn(process.execPath, ['--no-warnings', ENTRY, 'dev', '--stop'], { cwd })
    const bareCode = await new Promise((resolve) => bare.on('close', resolve))

    expect(bareCode).toBe(0)
    await until(() => !alive(state.pid) && !alive(grandchild), 'the server and its sleep to end')
    expect(await healthy(port)).toBe(false)
    expect(existsSync(join(cwd, '.wrangler/hollware-dev.json'))).toBe(false)
  })
})
