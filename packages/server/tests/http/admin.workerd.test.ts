import { describe, expect, it } from 'vitest'

import { boot, PUBLIC_URL } from './support.ts'

// Fails when: the admin at /admin/ (src/http/admin.ts) stops being served the way ADR-026 says:
// its page, and every path of the single-page app, goes out with the policy that frames nothing
// and runs only its own scripts; a file of the build is passed on as the assets serve it; a
// Worker without static assets says the admin is not installed; and /admin/config.json stops
// naming the admin's client, the same one on every request, its redirect URI and the resource it
// asks for, which is /v1.

const PAGE = '<!doctype html><title>Hollware</title><div id="app"></div>'

/** Static assets that hold the admin's page and one file, and record what was asked. */
function assets() {
  const asked: string[] = []
  const fetcher = {
    fetch: async (input: RequestInfo | URL) => {
      const url = new URL(input instanceof Request ? input.url : String(input))
      asked.push(url.pathname)
      if (url.pathname === '/admin/') {
        return new Response(PAGE, { headers: { 'content-type': 'text/html' } })
      }
      if (url.pathname === '/admin/favicon.svg') {
        return new Response('<svg/>', { headers: { 'content-type': 'image/svg+xml' } })
      }
      return new Response('not here', { status: 404 })
    },
    connect: () => {
      throw new Error('no sockets here')
    },
  }
  return { fetcher, asked }
}

describe('the admin', () => {
  it('serves its page, at every path of the app, with a policy that frames nothing', async () => {
    const { fetcher, asked } = assets()
    const worker = boot({ assets: fetcher })

    const root = await worker.send('/admin/')
    const deep = await worker.send('/admin/entries/ent_01JAB3XQ8ZK4M6N2P5R7S9T0VW')

    for (const response of [root, deep]) {
      expect(response.status).toBe(200)
      expect(await response.text()).toBe(PAGE)
      expect(Object.fromEntries(response.headers)).toMatchObject({
        'content-security-policy':
          "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: https:; connect-src 'self'; font-src 'self' data:; base-uri 'none'; form-action 'self'; frame-ancestors 'none'",
        'cross-origin-opener-policy': 'same-origin',
        'cross-origin-resource-policy': 'same-origin',
        'permissions-policy':
          'camera=(), microphone=(), geolocation=(), payment=(), usb=(), serial=()',
        'strict-transport-security': 'max-age=31536000',
        'x-content-type-options': 'nosniff',
      })
    }
    expect(asked).toEqual(['/admin/', '/admin/'])
  })

  it('says nothing of HTTPS when the public URL is http, as in local development', async () => {
    const { fetcher } = assets()
    // The OAuth server takes http on a loopback host only.
    const worker = boot({ assets: fetcher, publicUrl: 'http://localhost' })

    const page = await worker.send('/admin/', { host: 'localhost' })

    expect([page.status, page.headers.has('strict-transport-security')]).toEqual([200, false])
    expect(page.headers.get('x-content-type-options')).toBe('nosniff')
  })

  it('passes a file of the build on as it is, and says when the admin is not installed', async () => {
    const { fetcher } = assets()
    const installed = boot({ assets: fetcher })
    const bare = boot()

    const file = await installed.send('/admin/favicon.svg')
    const missing = await bare.send('/admin/')

    expect([file.status, await file.text()]).toEqual([200, '<svg/>'])
    expect(missing.status).toBe(404)
    expect(await missing.json()).toMatchObject({ code: 'not_found' })
  })

  it('names its own client, the same one each time, and asks for /v1', async () => {
    const worker = boot()

    const first = await (await worker.send('/admin/config.json')).json<Record<string, string>>()
    const second = await (await worker.send('/admin/config.json')).json<Record<string, string>>()

    expect(first).toEqual({
      issuer: PUBLIC_URL,
      clientId: expect.stringMatching(/^[\w-]{16}$/),
      redirectUri: `${PUBLIC_URL}/admin/callback`,
      resource: `${PUBLIC_URL}/v1`,
      scope: 'content:read content:write content:publish schema:admin',
    })
    expect(second.clientId).toBe(first.clientId)
  })
})
