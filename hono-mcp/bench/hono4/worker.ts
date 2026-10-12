// The Hono-only Worker of src/hono-only.ts written for Hono 4.13.13, to compare built sizes. It is
// built with `hono` aliased to the 4.13.13 copy that sits in the pnpm store (a transitive dependency
// of the conformance package), so nothing is added to the spike's dependencies. Not part of tsc.
import { Hono } from 'hono'
import { HTTPException } from 'hono/http-exception'

type Bindings = { APP_NAME: string }

const api = new Hono<{ Bindings: Bindings }>()
api.get('/ping', (c) => c.json({ app: c.env.APP_NAME }))
api.get('/conflict', () => {
  throw new HTTPException(409, { message: 'Version conflict' })
})

const app = new Hono<{ Bindings: Bindings }>()
app.use('*', async (c, next) => {
  await next()
  c.header('x-spike-app', c.env.APP_NAME)
})
app.get('/', (c) => c.json({ ok: true, name: c.env.APP_NAME }))
app.get('/items/:id', (c) => {
  const id = c.req.param('id')
  if (!/^\d+$/.test(id))
    throw new HTTPException(400, { message: `Item id must be digits, got "${id}"` })
  return c.json({ id: Number(id) })
})
app.get('/teapot', () => {
  throw new HTTPException(418, { message: "I'm a teapot" })
})
app.get('/crash', () => {
  throw new Error('secret internal detail')
})
app.route('/api', api)
// Hono 4 style: one (error, c) handler.
app.onError((error, c) => {
  if (error instanceof HTTPException) {
    if (error.res) return error.getResponse()
    return c.json({ error: { status: error.status, message: error.message } }, error.status)
  }
  console.error('unhandled error', error)
  return c.json({ error: { status: 500, message: 'Internal Server Error' } }, 500)
})
app.notFound((c) =>
  c.json({ error: { status: 404, message: `No route for ${c.req.method} ${c.req.path}` } }, 404),
)

export default app
