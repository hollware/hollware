import { exports } from 'cloudflare:workers'
import { describe, expect, it } from 'vitest'

// Fails when: src/index.ts stops exporting `{ fetch: hollware.fetch }` of createHollware(config) as
// the default export, so that GET /health for the public URL that wrangler.jsonc sets
// (localhost:5173) stops answering 200 with {"ok":true}, a request for another Host stops being a
// 403 with the forbidden_host code (the guard in front of every route), or POST /mcp without a
// token stops being a 401 with the unauthorized code. The gateway's own cases are the server
// package's tests; this pins that the playground is wired to it, with the public URL of `vp dev`.

const PUBLIC_HOST = 'localhost:5173'

// A request made inside workerd has no Host header of its own, so each test sends the one that a
// browser or `curl` would.
const asHost = (host: string) => ({ headers: { host } })

describe('the playground Worker over HTTP', () => {
  it('answers GET /health at its public URL', async () => {
    const response = await exports.default.fetch(
      `http://${PUBLIC_HOST}/health`,
      asHost(PUBLIC_HOST),
    )

    expect(response.status).toBe(200)
    expect(await response.text()).toBe('{"ok":true}')
  })

  it('refuses a request for another Host, and says which URL to use', async () => {
    const response = await exports.default.fetch(
      'http://playground.test/health',
      asHost('playground.test'),
    )

    expect(response.status).toBe(403)
    expect(await response.json()).toEqual({
      code: 'forbidden_host',
      message: 'The Host header of the request is not the public URL of this Hollware.',
      fix: 'Send the request to http://localhost:5173, the public URL of this Hollware (HOLLWARE_PUBLIC_URL).',
    })
  })

  it('answers 401 to /mcp without a token', async () => {
    const response = await exports.default.fetch(`http://${PUBLIC_HOST}/mcp`, {
      method: 'POST',
      ...asHost(PUBLIC_HOST),
    })

    expect(response.status).toBe(401)
    expect(response.headers.get('www-authenticate')).toBe('Bearer realm="hollware"')
    expect(await response.json()).toMatchObject({ code: 'unauthorized' })
  })
})
