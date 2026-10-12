import { exports } from 'cloudflare:workers'
import { OAuthProvider } from '@cloudflare/workers-oauth-provider'
import { describe, expect, it } from 'vitest'
import { apiHandler } from '../src/api.ts'
import { app } from '../src/app.ts'
import { bearer, signIn, wire, type Send } from './support/oauth.ts'

// O1. Fails when: providerOptions() (src/provider.ts) stops sending /mcp and /v1/ through the
// provider (apiRoute), stops handing everything else to the Hono app (defaultHandler), or the
// provider stops refusing an API route that its resource does not cover.

const send: Send = (input, init) => exports.default.fetch(input, init)
const base = 'https://hollware.test'

const CHALLENGE =
  'Bearer realm="OAuth", resource_metadata="https://hollware.test/.well-known/oauth-protected-resource", scope="content:read"'

describe('one Worker where the provider wraps everything', () => {
  it('serves a public route from the Hono app, the default handler', async () => {
    expect(await wire(await send(`${base}/`))).toEqual({
      status: 200,
      wwwAuthenticate: null,
      cacheControl: null,
      body: '{"name":"hollware-spike-oauth","public":true}',
    })
  })

  it.each(['/nope', '/mcpx', '/v10', '/mcp-other'])(
    'hands %s, which is not an API route, to Hono and gets its 404',
    async (path) => {
      expect(await wire(await send(`${base}${path}`))).toEqual({
        status: 404,
        wwwAuthenticate: null,
        cacheControl: null,
        body: '404 Not Found',
      })
    },
  )

  it.each(['/mcp', '/mcp/tools', '/v1', '/v1/', '/v1/entries'])(
    'guards %s itself: 401 with the challenge, never Hono',
    async (path) => {
      expect(await wire(await send(`${base}${path}`))).toEqual({
        status: 401,
        wwwAuthenticate: CHALLENGE,
        cacheControl: 'no-store',
        body: '',
      })
    },
  )

  it('hands an authenticated /mcp request to the apiHandler with the props of the grant', async () => {
    const { tokens } = await signIn(send, base, { scope: 'content:read', resource: base })

    const response = await send(`${base}/mcp`, bearer(tokens.access_token))

    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({
      handler: 'mcp',
      method: 'GET',
      path: '/mcp',
      props: { userId: 'usr_spike', scopes: ['content:read'], via: 'oauth' },
    })
  })

  it('hands an authenticated /v1/ request to the same apiHandler with the same token', async () => {
    const { tokens } = await signIn(send, base, { scope: 'content:read', resource: base })

    const response = await send(`${base}/v1/entries`, bearer(tokens.access_token))

    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({
      handler: 'v1',
      method: 'GET',
      path: '/v1/entries',
      props: { userId: 'usr_spike', scopes: ['content:read'], via: 'oauth' },
    })
  })

  it('answers CORS for any Origin by itself, a preflight included: an Origin guard has to sit in front of the provider', async () => {
    const evil = { Origin: 'https://evil.example' }

    const preflight = await send(`${base}/mcp`, {
      method: 'OPTIONS',
      headers: { ...evil, 'Access-Control-Request-Method': 'POST' },
    })
    const unauthenticated = await send(`${base}/mcp`, { headers: evil })

    expect(preflight.status).toBe(204)
    expect(preflight.headers.get('Access-Control-Allow-Origin')).toBe('https://evil.example')
    expect(unauthenticated.status).toBe(401)
    expect(unauthenticated.headers.get('Access-Control-Allow-Origin')).toBe('https://evil.example')
    expect(unauthenticated.headers.get('Access-Control-Expose-Headers')).toBe(
      'WWW-Authenticate, Retry-After',
    )
  })

  it('refuses to construct a provider whose API route its resource does not cover', () => {
    const construct = () =>
      new OAuthProvider<Env>({
        apiRoute: ['/mcp', '/v1/'],
        apiHandler,
        defaultHandler: app,
        authorizeEndpoint: `${base}/authorize`,
        tokenEndpoint: `${base}/oauth/token`,
        resourceMetadata: { resource: `${base}/mcp`, authorization_servers: [base] },
      })

    expect(construct).toThrow(
      new TypeError(
        'API route /v1/ is not covered by resourceMetadata.resource https://hollware.test/mcp. ' +
          'Protected routes must be the canonical resource path or a descendant of it; ' +
          'use https://hollware.test as the resource to cover every path on that origin.',
      ),
    )
  })
})
