import { generatePersonalToken } from '@hollware/core'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { boot, brokenDb, captureLogs, restoreLogs, wire } from './support.ts'

// Fails when: `GET /health` stops answering 200 `{ "ok": true }` without a token and without
// touching the database; a path with no route (or a known path with another method, or with a
// trailing slash) stops being the JSON 404; or a route that throws stops ending in the JSON 500:
// the status, the body (a fixed message, and the id of the request in the fix), the headers, and,
// above all, that nothing of the cause reaches the caller, where it stays in the log under the
// same id. A D1 failure while a token is checked is that 500, never a 401. Each request has an id
// of its own. The gateway is the Hono 5 app of `src/http/gateway.ts`, whose error handling is the
// Hono 5 form of `src/http/errors.ts`; this runs it in workerd over the real D1.

const REQUEST_ID = '0f3a8c52-7b1d-4e6a-9c04-5d2e8a1f6b37'

const HEADERS = { 'cache-control': 'no-store', 'content-type': 'application/json' }

const NOT_FOUND = {
  status: 404,
  headers: HEADERS,
  body: {
    code: 'not_found',
    message: 'This Hollware has no route for that path.',
    fix: 'Send MCP requests to /mcp with "Authorization: Bearer <token>". GET /health tells whether the Worker is up.',
  },
}

afterEach(() => {
  vi.restoreAllMocks()
  restoreLogs()
})

describe('GET /health', () => {
  it('answers 200 with { ok: true }, to anyone, without a query', async () => {
    const worker = boot()

    const response = await worker.send('/health')

    expect(await wire(response)).toEqual({ status: 200, headers: HEADERS, body: { ok: true } })
    expect(worker.queries).toEqual([])
    expect(worker.sessions).toEqual([])
    expect(worker.seen).toEqual([])
  })
})

describe('a path with no route', () => {
  it.each([
    ['GET', '/'],
    ['GET', '/nowhere'],
    ['GET', '/v1/entries'],
    ['GET', '/health/'],
    ['POST', '/health'],
    ['GET', '/mcp/'],
    ['POST', '/mcp/anything'],
  ])('is the JSON 404, for %s %s', async (method, path) => {
    const worker = boot()

    const response = await worker.send(path, { method, body: method === 'POST' ? '{}' : undefined })

    expect(await wire(response)).toEqual(NOT_FOUND)
    expect(worker.queries).toEqual([])
    expect(worker.seen).toEqual([])
  })
})

describe('a route that throws', () => {
  /** A database that is down: the token check is where the request meets it. */
  const down = () => brokenDb(new Error('D1_ERROR: no such table: tokens (secret detail)'))

  it('is the JSON 500 with the id of the request, and a D1 failure is no 401', async () => {
    const worker = boot({ db: down() })
    const token = generatePersonalToken()
    vi.spyOn(crypto, 'randomUUID').mockReturnValueOnce(REQUEST_ID)

    const response = await worker.send('/mcp', { method: 'POST', body: '{}', token })

    expect(await wire(response)).toEqual({
      status: 500,
      headers: HEADERS,
      body: {
        code: 'internal',
        message: 'The request failed on the server.',
        fix: `Try again. If it keeps failing, give the site operator this request id: ${REQUEST_ID}.`,
      },
    })
    expect(worker.seen).toEqual([])
  })

  it('sends nothing of the cause, and logs it under the same id', async () => {
    const logs = captureLogs()
    const worker = boot({ db: down() })
    const token = generatePersonalToken()
    vi.spyOn(crypto, 'randomUUID').mockReturnValueOnce(REQUEST_ID)

    const response = await worker.send('/mcp', { method: 'POST', body: '{}', token })

    const sent = JSON.stringify([...response.headers]) + (await response.text())
    expect(sent).not.toContain('D1_ERROR')
    expect(sent).not.toContain('secret detail')
    expect(sent).not.toContain('tokens')
    expect(logs.entries()).toEqual([
      {
        kind: 'request_error',
        requestId: REQUEST_ID,
        method: 'POST',
        path: '/mcp',
        detail: expect.stringContaining('D1_ERROR: no such table: tokens (secret detail)'),
      },
    ])
  })

  it('gives every request an id of its own, the one its log line has', async () => {
    const logs = captureLogs()
    const worker = boot({ db: down() })
    const send = async () => {
      const response = await worker.send('/mcp', {
        method: 'POST',
        body: '{}',
        token: generatePersonalToken(),
      })
      const { fix } = await response.json<{ fix: string }>()
      return /request id: ([0-9a-f-]{36})\.$/.exec(fix)?.[1]
    }

    const first = await send()
    const second = await send()

    expect(first).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/)
    expect(second).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/)
    expect(second).not.toBe(first)
    expect(logs.entries()).toEqual([
      expect.objectContaining({ kind: 'request_error', requestId: first }),
      expect.objectContaining({ kind: 'request_error', requestId: second }),
    ])
  })

  it('does not stop the next request: the Worker keeps answering', async () => {
    const worker = boot({ db: down() })

    await worker.send('/mcp', { method: 'POST', body: '{}', token: generatePersonalToken() })
    const next = await worker.send('/health')

    expect(next.status).toBe(200)
  })
})
