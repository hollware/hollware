import { Hono } from 'hono'
import { HTTPException } from 'hono/http-exception'
import type { AppEnv } from './app.ts'

/** A sub-app mounted with `app.route('/api', createApi())`: typed bindings flow through route(). */
export function createApi(): Hono<AppEnv> {
  const api = new Hono<AppEnv>()
  api.get('/ping', (c) => c.json({ app: c.env.APP_NAME }))
  api.get('/conflict', () => {
    throw new HTTPException(409, { message: 'Version conflict' })
  })
  return api
}
