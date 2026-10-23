import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vite-plus/test'
import { run } from './support/io.ts'
import { tempDirs } from './support/project.ts'
import { startStub, type StubOptions, type StubServer } from './support/stub-hollware.ts'

const TOKEN = `hw_pat_${'a'.repeat(52)}`
const KEY = 'phx_the_personal_key_0123456789abcdef'
const temp = tempDirs()
const stubs: StubServer[] = []

afterEach(async () => {
  for (const stub of stubs.splice(0)) await stub.close()
})

async function serve(options: Partial<StubOptions> = {}): Promise<StubServer> {
  const stub = await startStub({ token: TOKEN, ...options })
  stubs.push(stub)
  return stub
}

function withKey(key = KEY): string {
  const dir = temp.make()
  writeFileSync(join(dir, 'key.txt'), `${key}\n`)
  return dir
}

function runAnalytics(cwd: string, args: string[]) {
  return run(['analytics', ...args], { cwd, readStdin: () => Promise.resolve(`${TOKEN}\n`) })
}

const connected = () => ({
  outcome: 'connected' as const,
  settings: { host: 'https://us.posthog.com', projectId: 7, hosts: ['www.example.com'] },
  views: 380,
  paths: 24,
})

describe('hollware analytics', () => {
  it('connects a provider with the key of a file and the settings of the flags', async () => {
    const stub = await serve({ analytics: connected })
    const cwd = withKey()

    const result = await runAnalytics(cwd, [
      'connect',
      'posthog',
      '--credential-file',
      'key.txt',
      '--hosts',
      'www.example.com',
      '--project',
      '7',
      '--url',
      stub.url,
    ])

    expect(result.code).toBe(0)
    expect(result.out.join('\n')).toContain(
      'Connected to posthog: 380 views on 24 pages in the last 7 days.',
    )
    expect(stub.calls.filter((call) => call.tool === 'connect_analytics')).toEqual([
      {
        tool: 'connect_analytics',
        args: {
          provider: 'posthog',
          credential: KEY,
          settings: { hosts: ['www.example.com'], projectId: 7 },
        },
      },
    ])
  })

  it('says what is connected, without the key, and disconnects it once', async () => {
    const stub = await serve({ analytics: connected })
    const cwd = withKey()
    await runAnalytics(cwd, [
      'connect',
      'posthog',
      '--credential-file',
      'key.txt',
      '--url',
      stub.url,
    ])

    const status = await runAnalytics(cwd, ['status', '--url', stub.url])
    const first = await runAnalytics(cwd, ['disconnect', '--url', stub.url])
    const second = await runAnalytics(cwd, ['disconnect', '--url', stub.url])
    const after = await runAnalytics(cwd, ['status', '--url', stub.url])

    expect(status.out.join('\n')).toContain(
      'Reading from posthog, connected on 2026-10-22T10:00:00.000Z.',
    )
    expect(status.out.join('\n')).toContain('  projectId: 7')
    expect(status.out.join('\n')).toContain('  hosts: www.example.com')
    expect(status.out.join('\n')).not.toContain(KEY)
    expect(first.out.join('\n')).toContain('Disconnected')
    expect(second.out).toEqual(['No analytics were connected.'])
    expect(after.out.join('\n')).toContain('No analytics connected.')
  })

  it('never takes a key from the command line, an empty file or for an unknown provider', async () => {
    const stub = await serve({ analytics: connected })
    const cwd = withKey()
    writeFileSync(join(cwd, 'empty.txt'), '\n')

    const noFile = await runAnalytics(cwd, ['connect', 'posthog', '--url', stub.url])
    const empty = await runAnalytics(cwd, [
      'connect',
      'posthog',
      '--credential-file',
      'empty.txt',
      '--url',
      stub.url,
    ])
    const unknown = await runAnalytics(cwd, [
      'connect',
      'matomo',
      '--credential-file',
      'key.txt',
      '--url',
      stub.url,
    ])
    const project = await runAnalytics(cwd, [
      'connect',
      'posthog',
      '--credential-file',
      'key.txt',
      '--project',
      'abc',
      '--url',
      stub.url,
    ])

    expect([noFile.code, empty.code, unknown.code, project.code]).toEqual([1, 1, 1, 1])
    expect(noFile.err.join('\n')).toContain('--credential-file')
    expect(empty.err.join('\n')).toContain('is empty')
    expect(unknown.err.join('\n')).toContain('cloudflare, ga4, plausible, posthog')
    expect(project.err.join('\n')).toContain('--project')
    expect(stub.calls.filter((call) => call.tool === 'connect_analytics')).toEqual([])
  })

  it('tells what the provider refused, with its fix, and never repeats the key', async () => {
    const stub = await serve({
      analytics: () => ({
        outcome: 'refused',
        message: `The key ${KEY} lacks a scope.`,
        fix: 'Give the key the scope Query: read.',
      }),
    })

    const result = await runAnalytics(withKey(), [
      'connect',
      'posthog',
      '--credential-file',
      'key.txt',
      '--url',
      stub.url,
    ])

    expect(result.code).toBe(1)
    expect(result.err.join('\n')).toContain('posthog refused: The key [credential] lacks a scope.')
    expect(result.err.join('\n')).toContain('Give the key the scope Query: read.')
    expect(result.err.join('\n')).not.toContain(KEY)
  })

  it('says when the Hollware is too old to read analytics of its own', async () => {
    const stub = await serve()

    const result = await runAnalytics(withKey(), ['status', '--url', stub.url])

    expect(result.code).toBe(1)
    expect(result.err.join('\n')).toContain('1.0.0-rc.7 or later')
  })
})
