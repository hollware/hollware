import { env, exports } from 'cloudflare:workers'
import { getOAuthApi } from '@cloudflare/workers-oauth-provider'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { providerOptions } from '../src/provider.ts'
import {
  bearer,
  signIn,
  tokenRequest,
  wire,
  type Send,
  type TokenResponse,
} from './support/oauth.ts'

// O4. Fails when: the provider stops answering a missing, unknown, expired or revoked token with
// the 401 challenge of RFC 6750 / RFC 9728, or apiHandler() (src/api.ts) stops answering a token
// without the needed scopes with insufficientScope(): the provider enforces no scope by itself.

const send: Send = (input, init) => exports.default.fetch(input, init)
const base = 'https://hollware.test'

const RESOURCE_METADATA =
  'resource_metadata="https://hollware.test/.well-known/oauth-protected-resource"'

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe('401 without a usable token', () => {
  it('answers a request without Authorization with the challenge that names the metadata', async () => {
    expect(await wire(await send(`${base}/mcp`))).toEqual({
      status: 401,
      wwwAuthenticate: `Bearer realm="OAuth", ${RESOURCE_METADATA}, scope="content:read"`,
      cacheControl: 'no-store',
      body: '',
    })
  })

  it('answers an Authorization header that is not a bearer token the same way', async () => {
    const response = await send(`${base}/mcp`, { headers: { Authorization: 'Basic dXNlcjpwYXNz' } })

    expect(await wire(response)).toEqual({
      status: 401,
      wwwAuthenticate: `Bearer realm="OAuth", ${RESOURCE_METADATA}, scope="content:read"`,
      cacheControl: 'no-store',
      body: '',
    })
  })

  it('answers a bearer token the provider never issued with invalid_token', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const unknown = 'usr_spike:AAAAAAAAAAAAAAAA:BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB'

    expect(await wire(await send(`${base}/mcp`, bearer(unknown)))).toEqual({
      status: 401,
      wwwAuthenticate: `Bearer realm="OAuth", ${RESOURCE_METADATA}, error="invalid_token", scope="content:read"`,
      cacheControl: 'no-store',
      body: '{"error":"invalid_token","error_description":"Invalid access token"}',
    })
    expect(warn).toHaveBeenCalledWith(
      '{"event":"oauth.error","code":"invalid_token","status":401,"category":"protected-resource","reason":"token_not_found"}',
    )
  })

  it('answers an expired access token with invalid_token and lets the refresh token renew it', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const { client, tokens } = await signIn(send, base, { scope: 'content:read', resource: base })
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(Date.now() + 3601 * 1000)

    expect(await wire(await send(`${base}/mcp`, bearer(tokens.access_token)))).toEqual({
      status: 401,
      wwwAuthenticate: `Bearer realm="OAuth", ${RESOURCE_METADATA}, error="invalid_token", scope="content:read"`,
      cacheControl: 'no-store',
      body: '{"error":"invalid_token","error_description":"Access token expired"}',
    })
    expect(warn).toHaveBeenCalledWith(
      '{"event":"oauth.error","code":"invalid_token","status":401,"category":"protected-resource","reason":"token_expired"}',
    )
    const refreshed = await tokenRequest(send, base, {
      grant_type: 'refresh_token',
      refresh_token: tokens.refresh_token,
      client_id: client.client_id,
    })
    expect(refreshed.status).toBe(200)
  })
})

describe('403 insufficient_scope', () => {
  it('is the handler that answers it: the provider enforces no scope on a route', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const { tokens } = await signIn(send, base, { scope: 'content:read', resource: base })

    const response = await send(`${base}/mcp`, { method: 'POST', ...bearer(tokens.access_token) })

    expect(await wire(response)).toEqual({
      status: 403,
      wwwAuthenticate: `Bearer realm="OAuth", error="insufficient_scope", scope="content:read content:write", ${RESOURCE_METADATA}`,
      cacheControl: 'no-store',
      body: '{"error":"insufficient_scope"}',
    })
    expect(response.headers.get('Content-Type')).toBe('application/json')
    expect(warn).not.toHaveBeenCalled()
  })

  it('names every scope the operation needs, the baseline included', async () => {
    const { tokens } = await signIn(send, base, {
      scope: 'content:read content:write',
      resource: base,
    })

    const response = await send(`${base}/v1/publish`, {
      method: 'POST',
      ...bearer(tokens.access_token),
    })

    expect(response.status).toBe(403)
    expect(response.headers.get('WWW-Authenticate')).toBe(
      `Bearer realm="OAuth", error="insufficient_scope", scope="content:read content:publish", ${RESOURCE_METADATA}`,
    )
  })

  it('lets a token with no scope at all reach the handler: requiredScopes is advertised, not enforced', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const { tokens } = await signIn(send, base, { scope: '', resource: base })

    const response = await send(`${base}/mcp`, bearer(tokens.access_token))

    expect(tokens.scope).toBe('')
    expect(response.status).toBe(403)
    expect(response.headers.get('WWW-Authenticate')).toBe(
      `Bearer realm="OAuth", error="insufficient_scope", scope="content:read", ${RESOURCE_METADATA}`,
    )
    expect(warn).not.toHaveBeenCalled()
  })

  it('checks ctx.auth.scope, not props.scopes: a client can narrow a token at refresh, the props keep the grant', async () => {
    const { client, tokens } = await signIn(send, base, {
      scope: 'content:read content:write',
      resource: base,
    })

    const refreshed = await tokenRequest(send, base, {
      grant_type: 'refresh_token',
      refresh_token: tokens.refresh_token,
      client_id: client.client_id,
      scope: 'content:read',
    })
    const narrowed = await refreshed.json<TokenResponse>()
    const write = await send(`${base}/mcp`, { method: 'POST', ...bearer(narrowed.access_token) })

    expect(narrowed.scope).toBe('content:read')
    expect(write.status).toBe(403)
    const read = await send(`${base}/mcp`, bearer(narrowed.access_token))
    expect(await read.json()).toMatchObject({
      props: { scopes: ['content:read', 'content:write'] },
      auth: { scope: ['content:read'] },
    })
  })

  it('lets a token that has the scopes through', async () => {
    const { tokens } = await signIn(send, base, {
      scope: 'content:read content:publish',
      resource: base,
    })

    const response = await send(`${base}/v1/publish`, {
      method: 'POST',
      ...bearer(tokens.access_token),
    })

    expect(response.status).toBe(200)
  })
})

describe('401 for a revoked token', () => {
  const REVOKED = {
    status: 401,
    wwwAuthenticate: `Bearer realm="OAuth", ${RESOURCE_METADATA}, error="invalid_token", scope="content:read"`,
    cacheControl: 'no-store',
    body: '{"error":"invalid_token","error_description":"Invalid access token"}',
  }

  it('answers an access token its client revoked (RFC 7009) with invalid_token', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    const { client, tokens } = await signIn(send, base, { scope: 'content:read', resource: base })
    expect((await send(`${base}/mcp`, bearer(tokens.access_token))).status).toBe(200)

    const revoked = await tokenRequest(send, base, {
      token: tokens.access_token,
      token_type_hint: 'access_token',
      client_id: client.client_id,
    })

    expect(revoked.status).toBe(200)
    expect(await wire(await send(`${base}/mcp`, bearer(tokens.access_token)))).toEqual(REVOKED)
  })

  it('answers the access token of a grant whose refresh token was revoked the same way', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    const { client, tokens } = await signIn(send, base, { scope: 'content:read', resource: base })

    await tokenRequest(send, base, {
      token: tokens.refresh_token,
      token_type_hint: 'refresh_token',
      client_id: client.client_id,
    })

    expect(await wire(await send(`${base}/mcp`, bearer(tokens.access_token)))).toEqual(REVOKED)
    const refresh = await tokenRequest(send, base, {
      grant_type: 'refresh_token',
      refresh_token: tokens.refresh_token,
      client_id: client.client_id,
    })
    expect(refresh.status).toBe(400)
  })

  it('answers the access token of a grant the Worker revokes for a user (admin revokeGrant) the same way', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    const { tokens } = await signIn(send, base, { scope: 'content:read', resource: base })
    const oauth = getOAuthApi(providerOptions(base), env)
    const summary = await oauth.unwrapToken(tokens.access_token)
    expect(summary?.userId).toBe('usr_spike')

    await oauth.revokeGrant(summary?.grantId ?? '', 'usr_spike')

    expect(await wire(await send(`${base}/mcp`, bearer(tokens.access_token)))).toEqual(REVOKED)
  })
})
