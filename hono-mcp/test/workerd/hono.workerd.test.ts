import { exports } from 'cloudflare:workers'
import { describe, expect, it } from 'vitest'

// S1a. Fails when: src/app.ts stops answering the routes below with the literal status and body, the
// middleware stops stamping x-spike-app (from the typed binding APP_NAME), or the Hono 5 error
// handling in src/http/errors.ts stops turning HTTPException / Error / unknown paths into JSON.

describe('the Hono 5 app over HTTP (S1a)', () => {
  it('answers GET / with the binding value and the middleware header', async () => {
    const response = await exports.default.fetch('http://spike.test/')

    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toBe('application/json')
    expect(response.headers.get('x-spike-app')).toBe('spike-hono-mcp')
    expect(await response.text()).toBe('{"ok":true,"name":"spike-hono-mcp"}')
  })

  it('reads a route param', async () => {
    const response = await exports.default.fetch('http://spike.test/items/42')

    expect(response.status).toBe(200)
    expect(await response.text()).toBe('{"id":42}')
  })

  it('turns an HTTPException thrown by a route into a JSON error body', async () => {
    const response = await exports.default.fetch('http://spike.test/items/abc')

    expect(response.status).toBe(400)
    expect(response.headers.get('content-type')).toBe('application/json')
    // The middleware still runs after the handler threw: the error response is stamped too.
    expect(response.headers.get('x-spike-app')).toBe('spike-hono-mcp')
    expect(await response.text()).toBe(
      '{"error":{"status":400,"message":"Item id must be digits, got \\"abc\\""}}',
    )
  })

  it('keeps the status of an HTTPException that is not 400', async () => {
    const response = await exports.default.fetch('http://spike.test/teapot')

    expect(response.status).toBe(418)
    expect(await response.text()).toBe('{"error":{"status":418,"message":"I\'m a teapot"}}')
  })

  it('hides the message of an unexpected Error behind a JSON 500', async () => {
    const response = await exports.default.fetch('http://spike.test/crash')

    expect(response.status).toBe(500)
    expect(await response.text()).toBe('{"error":{"status":500,"message":"Internal Server Error"}}')
  })

  it('answers an unknown path with the JSON from app.notFound', async () => {
    const response = await exports.default.fetch('http://spike.test/nope')

    expect(response.status).toBe(404)
    expect(response.headers.get('content-type')).toBe('application/json')
    expect(await response.text()).toBe(
      '{"error":{"status":404,"message":"No route for GET /nope"}}',
    )
  })

  it('answers a method without a route with the same 404', async () => {
    const response = await exports.default.fetch('http://spike.test/', { method: 'POST' })

    expect(response.status).toBe(404)
    expect(await response.text()).toBe('{"error":{"status":404,"message":"No route for POST /"}}')
  })

  it('serves a sub-app mounted with app.route, with typed bindings', async () => {
    const response = await exports.default.fetch('http://spike.test/api/ping')

    expect(response.status).toBe(200)
    expect(response.headers.get('x-spike-app')).toBe('spike-hono-mcp')
    expect(await response.text()).toBe('{"app":"spike-hono-mcp"}')
  })

  it('renders what a mounted sub-app throws with the root error handler', async () => {
    const response = await exports.default.fetch('http://spike.test/api/conflict')

    expect(response.status).toBe(409)
    expect(await response.text()).toBe('{"error":{"status":409,"message":"Version conflict"}}')
  })

  it('answers a path missing under the mount with the root JSON 404', async () => {
    const response = await exports.default.fetch('http://spike.test/api/missing')

    expect(response.status).toBe(404)
    expect(await response.text()).toBe(
      '{"error":{"status":404,"message":"No route for GET /api/missing"}}',
    )
  })
})
