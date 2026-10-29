import type { HollwareRpc } from '@hollware/server'
import { afterAll, beforeAll, describe, expect, it } from 'vite-plus/test'

import { migrate, SITE_KEY } from './support.ts'
import { createPlaygroundHarness, HOLLWARE_URL, SITE_WORKER, siteFetch } from './workers.ts'

const server = createPlaygroundHarness()

type Binding = Record<string, (...args: unknown[]) => Promise<unknown>>

async function callBinding(name: string, ...args: unknown[]): Promise<void> {
  const { HOLLWARE } = await server.getWorker<{ HOLLWARE: Binding }>(SITE_WORKER).getEnv()
  await HOLLWARE[name]?.(...args)
}

function logged(kind: string): Record<string, unknown>[] {
  return server.getLogs().flatMap(({ message }) => {
    try {
      const line: unknown = JSON.parse(message)
      return typeof line === 'object' && line !== null && 'kind' in line && line.kind === kind
        ? [Object.fromEntries(Object.entries(line))]
        : []
    } catch {
      return []
    }
  })
}

beforeAll(async () => {
  await server.listen()
})

afterAll(async () => {
  await server.close()
})

describe('a failure of the server', () => {
  it('reaches the site as `internal`, with a request id and without its cause', async () => {
    server.clearLogs()

    const response = await siteFetch(server, '/blog/')

    expect(response.status).toBe(502)
    const [seen, ...others] = logged('hollware_error')
    expect(others).toEqual([])
    expect(seen).toEqual({
      kind: 'hollware_error',
      name: 'HollwareError',
      message: 'The operation failed on the server.',
      code: 'internal',
      fix: expect.stringMatching(
        /^Try again\. If it keeps failing, give the site operator this request id: [0-9a-f-]{36}\.$/,
      ),
      hasCause: false,
    })
    expect(JSON.stringify(seen)).not.toContain('no such table')
    const [hidden] = logged('rpc_error')
    expect(hidden).toMatchObject({ method: 'listEntries', errorCode: null })
    expect(hidden?.['detail']).toEqual(expect.stringContaining('D1_ERROR: no such table: sites'))
    expect(String(seen?.['fix'])).toContain(String(hidden?.['requestId']))
  })
})

describe('the binding of the site', () => {
  beforeAll(async () => {
    await migrate(server)
  })

  it('carries an error of the caller with its name, message, code and fix, and no cause', async () => {
    server.clearLogs()

    const response = await siteFetch(server, '/blog/?cursor=not-a-cursor')

    expect(response.status).toBe(400)
    expect(logged('hollware_error')).toEqual([
      {
        kind: 'hollware_error',
        name: 'HollwareError',
        message: 'The cursor is not valid for this listing.',
        code: 'invalid_input',
        fix: 'Pass the nextCursor of the previous answer unchanged, to the same operation, or leave cursor out to start from the first page.',
        hasCause: false,
      },
    ])
  })

  it('answers the seven read methods', async () => {
    const { HOLLWARE } = await server.getWorker<{ HOLLWARE: HollwareRpc }>(SITE_WORKER).getEnv()

    expect(await HOLLWARE.listEntries(SITE_KEY, 'blog')).toEqual({
      outcome: 'ok',
      entries: [],
      nextCursor: null,
    })
    expect(await HOLLWARE.getEntry(SITE_KEY, 'blog', 'nothing-here', 'en')).toEqual({
      outcome: 'not_found',
    })
    expect(await HOLLWARE.getTranslations(SITE_KEY, 'blog', 'no-group')).toEqual({
      outcome: 'not_found',
    })
    expect(await HOLLWARE.getNavigation(SITE_KEY, 'blog')).toEqual({
      outcome: 'ok',
      collection: 'blog',
      locale: 'es',
      groups: [],
    })
    expect(await HOLLWARE.describeSite(SITE_KEY)).toMatchObject({
      outcome: 'ok',
      site: { key: 'playground' },
    })
    expect(await HOLLWARE.listRedirects(SITE_KEY)).toEqual({
      outcome: 'ok',
      redirects: [],
      nextCursor: null,
    })
    expect(await HOLLWARE.search(SITE_KEY, 'nothing written yet')).toMatchObject({
      outcome: 'ok',
      mode: 'fulltext',
      results: [],
    })
  })

  it.each([
    'createDraft',
    'create_draft',
    'updateDraft',
    'update_draft',
    'validate',
    'publish',
    'unpublish',
  ])('has no method that writes: %s', async (name) => {
    await expect(callBinding(name, SITE_KEY)).rejects.toThrow(
      `The RPC receiver does not implement the method "${name}".`,
    )
  })

  it.each(['env', 'ctx', 'unknownMethod'])('has nothing else to call: %s', async (name) => {
    await expect(callBinding(name)).rejects.toThrow(
      `The RPC receiver does not implement the method "${name}".`,
    )
  })

  it('cannot be fetched: its entrypoint has no fetch handler, so the gateway is not behind it', async () => {
    await expect(callBinding('fetch', `${HOLLWARE_URL}/health`)).rejects.toThrow(
      'Handler does not export a fetch() function.',
    )
  })
})
