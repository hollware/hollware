import { exports } from 'cloudflare:workers'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { bearer, wire, type Send } from './support/oauth.ts'

// O5. Fails when: providerOptions() (src/provider.ts) stops passing resolveExternalToken to the
// provider, stops returning the audience of the resource, or the provider stops calling the hook
// for a bearer token that is not in its own format and not in its KV.

const send: Send = (input, init) => exports.default.fetch(input, init)
const base = 'https://hollware.test'

const INVALID_TOKEN =
  'Bearer realm="OAuth", resource_metadata="https://hollware.test/.well-known/oauth-protected-resource", error="invalid_token", scope="content:read"'

afterEach(() => {
  vi.restoreAllMocks()
})

describe('personal tokens through resolveExternalToken', () => {
  it('hands the props of a valid hw_pat_ token to the apiHandler', async () => {
    const response = await send(`${base}/mcp`, bearer('hw_pat_test'))

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({
      handler: 'mcp',
      method: 'GET',
      path: '/mcp',
      props: {
        userId: 'usr_pat',
        scopes: ['content:read', 'content:write'],
        via: 'pat',
        tokenId: 'tok_test',
      },
      // The provider reports nothing about an external token but its audience: the handler has to
      // read the scopes and the user from the props.
      auth: { audience: 'https://hollware.test', scope: [], userId: null, clientId: null },
    })
  })

  it('lets the handler enforce the scopes of the token from its props', async () => {
    const write = await send(`${base}/mcp`, { method: 'POST', ...bearer('hw_pat_test') })
    const publish = await send(`${base}/v1/publish`, { method: 'POST', ...bearer('hw_pat_test') })

    expect(write.status).toBe(200)
    expect(await wire(publish)).toEqual({
      status: 403,
      wwwAuthenticate:
        'Bearer realm="OAuth", error="insufficient_scope", scope="content:read content:publish", resource_metadata="https://hollware.test/.well-known/oauth-protected-resource"',
      cacheControl: 'no-store',
      body: '{"error":"insufficient_scope"}',
    })
  })

  it('answers an unknown hw_pat_ token with 401 invalid_token', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})

    expect(await wire(await send(`${base}/mcp`, bearer('hw_pat_unknown')))).toEqual({
      status: 401,
      wwwAuthenticate: INVALID_TOKEN,
      cacheControl: 'no-store',
      body: '{"error":"invalid_token","error_description":"Invalid access token"}',
    })
    expect(warn).toHaveBeenCalledWith(
      '{"event":"oauth.error","code":"invalid_token","status":401,"category":"protected-resource","reason":"external_token_rejected"}',
    )
  })

  it.each([
    ['hw_pat_expired', 'Personal token expired'],
    ['hw_pat_revoked', 'Personal token revoked'],
  ])('says why %s is refused, through ExternalTokenError', async (token, description) => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})

    expect(await wire(await send(`${base}/mcp`, bearer(token)))).toEqual({
      status: 401,
      wwwAuthenticate: INVALID_TOKEN,
      cacheControl: 'no-store',
      body: JSON.stringify({ error: 'invalid_token', error_description: description }),
    })
    expect(warn).toHaveBeenCalledWith(
      '{"event":"oauth.error","code":"invalid_token","status":401,"category":"protected-resource","reason":"resolver_rejected"}',
    )
  })

  it('never calls the hook for a token in the provider format that is not in its KV', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const lookalike = 'hw_pat_lookalike:AAAAAAAAAAAAAAAA:BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB'

    const response = await send(`${base}/mcp`, bearer(lookalike))

    expect(response.status).toBe(401)
    // `token_not_found` is the provider answering by itself; a hook answer is `external_token_rejected`.
    expect(warn).toHaveBeenCalledWith(
      '{"event":"oauth.error","code":"invalid_token","status":401,"category":"protected-resource","reason":"token_not_found"}',
    )
  })
})
