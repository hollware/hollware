import { Hono } from 'hono'
import { describe, expect, it } from 'vite-plus/test'

import { installErrorHandling } from '../../src/http/errors.ts'
import type { GatewayEnv, GatewayLogEntry } from '../../src/http/types.ts'

const HEADERS = { 'cache-control': 'no-store', 'content-type': 'application/json' }

function appThatThrows(thrown: unknown) {
  const logs: GatewayLogEntry[] = []
  const app = new Hono<GatewayEnv>()
  app.use('*', async (c, next) => {
    c.set('requestId', 'req-7')
    await next()
  })
  app.get('/boom', () => {
    throw thrown
  })
  installErrorHandling(app, (entry) => void logs.push(entry))
  return { app, logs }
}

async function wire(response: Response) {
  return {
    status: response.status,
    headers: Object.fromEntries(response.headers),
    body: await response.json(),
  }
}

describe('a route that throws', () => {
  const INTERNAL = {
    status: 500,
    headers: HEADERS,
    body: {
      code: 'internal',
      message: 'The request failed on the server.',
      fix: 'Try again. If it keeps failing, give the site operator this request id: req-7.',
    },
  }

  it.each([
    ['an Error', new Error('the database said: secret detail')],
    ['a string', 'secret detail'],
    ['an object', { secret: 'detail' }],
  ])(
    'is the JSON 500 whatever it throws, as %s, and sends nothing of it',
    async (_kind, thrown) => {
      const { app } = appThatThrows(thrown)

      const response = await app.request('/boom')

      expect(await wire(response)).toEqual(INTERNAL)
    },
  )

  it('logs the cause with the id, the method and the path, and drops the query string', async () => {
    const { app, logs } = appThatThrows(new Error('the database said: secret detail'))

    await app.request('/boom?token=hw_pat_never-logged')

    expect(logs).toEqual([
      {
        kind: 'request_error',
        requestId: 'req-7',
        method: 'GET',
        path: '/boom',
        detail: expect.stringContaining('Error: the database said: secret detail'),
      },
    ])
  })

  it('logs the cause of a string that was thrown', async () => {
    const { app, logs } = appThatThrows('secret detail')

    await app.request('/boom')

    expect(logs).toEqual([
      expect.objectContaining({ detail: expect.stringContaining('secret detail') }),
    ])
  })
})

describe('a path with no route', () => {
  it('is the JSON 404, and logs nothing', async () => {
    const { app, logs } = appThatThrows(new Error('unused'))

    const response = await app.request('/nowhere')

    expect(await wire(response)).toEqual({
      status: 404,
      headers: HEADERS,
      body: {
        code: 'not_found',
        message: 'This Hollware has no route for that path.',
        fix: 'Send MCP requests to /mcp with "Authorization: Bearer <token>". GET /health tells whether the Worker is up.',
      },
    })
    expect(logs).toEqual([])
  })
})
