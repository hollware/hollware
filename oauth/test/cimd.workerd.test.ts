import { exports } from 'cloudflare:workers'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  authorize,
  bearer,
  codeOf,
  PKCE_VERIFIER,
  REDIRECT_URI,
  tokenRequest,
  wire,
  type Send,
  type TokenResponse,
} from './support/oauth.ts'

// O6. Fails when: providerOptions() (src/provider.ts) stops enabling Client ID Metadata Documents,
// wrangler.jsonc drops global_fetch_strictly_public, or the provider stops resolving a URL
// client_id with the global fetch().

const send: Send = (input, init) => exports.default.fetch(input, init)
const base = 'https://hollware.test'

function document(clientId: string): Record<string, unknown> {
  return {
    client_id: clientId,
    client_name: 'CIMD Agent',
    redirect_uris: [REDIRECT_URI],
    grant_types: ['authorization_code', 'refresh_token'],
    response_types: ['code'],
    token_endpoint_auth_method: 'none',
  }
}

interface Served {
  body: Record<string, unknown>
  headers?: Record<string, string>
}

/**
 * Stands for the web: serves `documents` by URL, anything else is a 404. The Response is built
 * inside the call: one created in the test cannot be read from the request that fetches it.
 */
function mockWeb(documents: Record<string, Served>) {
  return vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
    const served = documents[url]
    if (served === undefined) return new Response('not found', { status: 404 })
    return Response.json(served.body, { headers: served.headers })
  })
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe('Client ID Metadata Documents', () => {
  it('runs with global_fetch_strictly_public, the flag the provider requires', () => {
    expect(Cloudflare.compatibilityFlags.global_fetch_strictly_public).toBe(true)
  })

  it('signs a client in whose client_id is a URL, fetching its document with the global fetch()', async () => {
    const clientId = 'https://agent.example/oauth/client.json'
    const web = mockWeb({
      [clientId]: { body: document(clientId), headers: { 'Cache-Control': 'max-age=300' } },
    })

    const approved = await authorize(send, base, {
      clientId,
      scope: 'content:read',
      resource: base,
    })
    const exchanged = await tokenRequest(send, base, {
      grant_type: 'authorization_code',
      code: codeOf(approved),
      redirect_uri: REDIRECT_URI,
      client_id: clientId,
      code_verifier: PKCE_VERIFIER,
      resource: base,
    })
    const tokens = await exchanged.json<TokenResponse>()
    const api = await send(`${base}/mcp`, bearer(tokens.access_token))

    expect(web).toHaveBeenCalledTimes(1)
    expect(web).toHaveBeenCalledWith(clientId, {
      headers: {
        Accept: 'application/json',
        'Cache-Control': 'no-store',
        'User-Agent':
          'workers-oauth-provider/1.2.3 (+https://github.com/cloudflare/workers-oauth-provider)',
      },
      signal: expect.any(AbortSignal),
      cache: 'no-store',
    })
    expect(exchanged.status).toBe(200)
    expect(await api.json()).toMatchObject({
      auth: { clientId: 'https://agent.example/oauth/client.json', scope: ['content:read'] },
    })
  })

  it('fetches again on every lookup when the document is not cacheable (3 lookups in one sign-in)', async () => {
    const clientId = 'https://agent.example/oauth/uncacheable.json'
    const web = mockWeb({ [clientId]: { body: document(clientId) } })

    const approved = await authorize(send, base, {
      clientId,
      scope: 'content:read',
      resource: base,
    })
    await tokenRequest(send, base, {
      grant_type: 'authorization_code',
      code: codeOf(approved),
      redirect_uri: REDIRECT_URI,
      client_id: clientId,
      code_verifier: PKCE_VERIFIER,
      resource: base,
    })

    expect(web).toHaveBeenCalledTimes(3)
  })

  it('does not follow the provider into a private address: it fetches whatever HTTPS URL it is given', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const web = mockWeb({})

    const response = await authorize(send, base, {
      clientId: 'https://127.0.0.1/client.json',
      scope: 'content:read',
      resource: base,
    })

    expect(web).toHaveBeenCalledTimes(1)
    expect(web.mock.calls[0]?.[0]).toBe('https://127.0.0.1/client.json')
    // Redirects are followed: the provider does not set `redirect: 'manual'`.
    expect(web.mock.calls[0]?.[1]).not.toHaveProperty('redirect')
    expect(await wire(response)).toMatchObject({
      status: 400,
      body: 'This app could not be verified.',
    })
    expect(warn).toHaveBeenCalledWith(
      'CIMD fetch failed for https://127.0.0.1/client.json:',
      'Failed to fetch client metadata: HTTP 404',
    )
  })

  it('refuses a document whose client_id is not the URL it was served from', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const url = 'https://agent.example/oauth/impostor.json'
    mockWeb({ [url]: { body: document('https://other.example/oauth/client.json') } })

    const response = await authorize(send, base, {
      clientId: url,
      scope: 'content:read',
      resource: base,
    })

    expect(await wire(response)).toMatchObject({
      status: 400,
      body: 'This app could not be verified.',
    })
    expect(warn).toHaveBeenCalledWith(
      'CIMD fetch failed for https://agent.example/oauth/impostor.json:',
      'client_id "https://other.example/oauth/client.json" does not match metadata URL "https://agent.example/oauth/impostor.json"',
    )
  })

  it('answers the token endpoint with a generic invalid_client when the document cannot be resolved', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    mockWeb({})

    const response = await tokenRequest(send, base, {
      grant_type: 'authorization_code',
      code: 'usr_spike:AAAAAAAAAAAAAAAA:BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB',
      redirect_uri: REDIRECT_URI,
      client_id: 'https://agent.example/oauth/gone.json',
      code_verifier: PKCE_VERIFIER,
    })

    expect(await wire(response)).toEqual({
      status: 401,
      wwwAuthenticate: null,
      cacheControl: 'no-store',
      body: '{"error":"invalid_client","error_description":"Client not found"}',
    })
    expect(warn).toHaveBeenCalledWith(
      '{"event":"oauth.error","code":"invalid_client","status":401,"category":"client-id-metadata-document","reason":"metadata_resolution_failed"}',
    )
  })
})
