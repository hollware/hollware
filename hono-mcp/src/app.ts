import type { AuthInfo } from '@modelcontextprotocol/server'
import { Hono } from 'hono'
import { HTTPException } from 'hono/http-exception'
import { createApi } from './api.ts'
import { installErrorHandling } from './http/errors.ts'

/**
 * Typed bindings: `c.env` is the generated `Env` (worker-configuration.d.ts). Typed variables: a
 * middleware that verifies a token does `c.set('authInfo', ...)`, the /mcp route hands it to the SDK.
 */
export type AppEnv = { Bindings: Env; Variables: { authInfo?: AuthInfo } }

/**
 * The S1 surface: a route with a param, a middleware, errors as JSON, a JSON 404.
 * Shared by the Hono-only Worker and the Hono + MCP Worker.
 */
export function createBaseApp(): Hono<AppEnv> {
  const app = new Hono<AppEnv>()

  // Middleware: runs around every route, reads a binding, sets a header after the handler.
  app.use('*', async (c, next) => {
    await next()
    c.header('x-spike-app', c.env.APP_NAME)
  })

  app.get('/', (c) => c.json({ ok: true, name: c.env.APP_NAME }))

  // A route with a param.
  app.get('/items/:id', (c) => {
    const id = c.req.param('id')
    if (!/^\d+$/.test(id)) {
      throw new HTTPException(400, { message: `Item id must be digits, got "${id}"` })
    }
    return c.json({ id: Number(id) })
  })

  app.get('/teapot', () => {
    throw new HTTPException(418, { message: "I'm a teapot" })
  })

  app.get('/crash', () => {
    throw new Error('secret internal detail')
  })

  app.route('/api', createApi())

  // After route(): the root handlers also cover what the mounted sub-app throws or misses.
  installErrorHandling(app)
  return app
}
