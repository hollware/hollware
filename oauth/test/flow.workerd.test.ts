import { exports } from 'cloudflare:workers'
import { describe, expect, it } from 'vitest'
import {
  authorize,
  bearer,
  codeOf,
  PKCE_VERIFIER,
  REDIRECT_URI,
  register,
  signIn,
  STATE,
  tokenRequest,
  wire,
  type OAuthErrorBody,
  type Send,
  type TokenResponse,
} from './support/oauth.ts'

// O3. Fails when: the provider options (src/provider.ts), approve() (src/approve.ts) or the
// apiHandler (src/api.ts) stop completing the flow dynamic registration -> /authorize with PKCE S256
// -> /oauth/token -> bearer call with the props `{ userId, scopes }` the grant stored, or the
// provider stops rotating refresh tokens.

const send: Send = (input, init) => exports.default.fetch(input, init)
const base = 'https://hollware.test'

const TOKEN_FORMAT = /^usr_spike:[A-Za-z0-9_-]{16}:[A-Za-z0-9_-]{32}$/

describe('authorization code flow with PKCE S256', () => {
  it('registers a public client dynamically (RFC 7591)', async () => {
    const client = await register(send, base)

    expect(client.client_id).toMatch(/^[A-Za-z0-9_-]{16}$/)
    expect({ ...client, client_id: 'x', client_id_issued_at: 0 }).toEqual({
      client_id: 'x',
      client_id_issued_at: 0,
      client_name: 'Spike Agent',
      redirect_uris: ['https://client.test/callback'],
      grant_types: ['authorization_code', 'refresh_token'],
      response_types: ['code'],
      token_endpoint_auth_method: 'none',
    })
  })

  it('answers /authorize with a redirect carrying the code, the state and the issuer (RFC 9207)', async () => {
    const client = await register(send, base)

    const response = await authorize(send, base, {
      clientId: client.client_id,
      scope: 'content:read content:write',
      resource: base,
    })

    expect(response.status).toBe(302)
    const location = new URL(response.headers.get('Location') ?? '')
    expect(`${location.origin}${location.pathname}`).toBe('https://client.test/callback')
    expect(location.searchParams.get('code')).toMatch(TOKEN_FORMAT)
    expect(location.searchParams.get('state')).toBe(STATE)
    expect(location.searchParams.get('iss')).toBe('https://hollware.test')
  })

  it('exchanges the code and the verifier for tokens bound to the resource', async () => {
    const { tokens } = await signIn(send, base, {
      scope: 'content:read content:write offline_access',
      resource: base,
    })

    expect(tokens.access_token).toMatch(TOKEN_FORMAT)
    expect(tokens.refresh_token).toMatch(TOKEN_FORMAT)
    expect({ ...tokens, access_token: 'x', refresh_token: 'y' }).toEqual({
      access_token: 'x',
      refresh_token: 'y',
      token_type: 'bearer',
      expires_in: 3600,
      scope: 'content:read content:write offline_access',
      resource: 'https://hollware.test',
    })
  })

  it('reaches the apiHandler with the props the grant stored and the verified token', async () => {
    const { client, tokens } = await signIn(send, base, {
      scope: 'content:read content:write',
      resource: base,
    })

    const response = await send(`${base}/mcp`, bearer(tokens.access_token))

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({
      handler: 'mcp',
      method: 'GET',
      path: '/mcp',
      props: { userId: 'usr_spike', scopes: ['content:read', 'content:write'], via: 'oauth' },
      auth: {
        audience: 'https://hollware.test',
        scope: ['content:read', 'content:write'],
        userId: 'usr_spike',
        clientId: client.client_id,
      },
    })
  })

  it('refuses a code_verifier that does not hash to the challenge', async () => {
    const client = await register(send, base)
    const approved = await authorize(send, base, {
      clientId: client.client_id,
      scope: 'content:read',
      resource: base,
    })

    const response = await tokenRequest(send, base, {
      grant_type: 'authorization_code',
      code: codeOf(approved),
      redirect_uri: REDIRECT_URI,
      client_id: client.client_id,
      code_verifier: `${PKCE_VERIFIER}x`,
      resource: base,
    })

    expect(response.status).toBe(400)
    expect(await response.json()).toEqual({
      error: 'invalid_grant',
      error_description: 'Invalid PKCE code_verifier',
    })
  })

  it('revokes the grant, and the tokens it issued, when a code is redeemed twice', async () => {
    const client = await register(send, base)
    const code = codeOf(
      await authorize(send, base, {
        clientId: client.client_id,
        scope: 'content:read',
        resource: base,
      }),
    )
    const form = {
      grant_type: 'authorization_code',
      code,
      redirect_uri: REDIRECT_URI,
      client_id: client.client_id,
      code_verifier: PKCE_VERIFIER,
      resource: base,
    }
    const first = await tokenRequest(send, base, form)
    const tokens = await first.json<TokenResponse>()
    expect((await send(`${base}/mcp`, bearer(tokens.access_token))).status).toBe(200)

    const replay = await tokenRequest(send, base, form)

    expect(replay.status).toBe(400)
    expect(await replay.json()).toEqual({
      error: 'invalid_grant',
      error_description: 'Authorization code already used',
    })
    expect((await send(`${base}/mcp`, bearer(tokens.access_token))).status).toBe(401)
  })
})

describe('refresh token rotation', () => {
  function refresh(clientId: string, refreshToken: string): Promise<Response> {
    return tokenRequest(send, base, {
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
      client_id: clientId,
    })
  }

  it('issues a new refresh token, and a new access token that works, on every refresh', async () => {
    const { client, tokens } = await signIn(send, base, { scope: 'content:read', resource: base })

    const response = await refresh(client.client_id, tokens.refresh_token)

    expect(response.status).toBe(200)
    const refreshed = await response.json<TokenResponse>()
    expect(refreshed.refresh_token).toMatch(TOKEN_FORMAT)
    expect(refreshed.refresh_token).not.toBe(tokens.refresh_token)
    expect(refreshed.access_token).not.toBe(tokens.access_token)
    expect({ ...refreshed, access_token: 'x', refresh_token: 'y' }).toEqual({
      access_token: 'x',
      refresh_token: 'y',
      token_type: 'bearer',
      expires_in: 3600,
      scope: 'content:read',
      resource: 'https://hollware.test',
    })
    expect((await send(`${base}/mcp`, bearer(refreshed.access_token))).status).toBe(200)
  })

  it('still honours the previous refresh token until its replacement is used (a lost response can be retried)', async () => {
    const { client, tokens } = await signIn(send, base, { scope: 'content:read', resource: base })
    const second = await (
      await refresh(client.client_id, tokens.refresh_token)
    ).json<TokenResponse>()

    const retry = await refresh(client.client_id, tokens.refresh_token)

    expect(retry.status).toBe(200)
    const third = await retry.json<TokenResponse>()
    expect(third.refresh_token).not.toBe(tokens.refresh_token)
    expect(third.refresh_token).not.toBe(second.refresh_token)
  })

  it('rejects a rotated-out refresh token once its replacement was used, and keeps the grant alive', async () => {
    const { client, tokens } = await signIn(send, base, { scope: 'content:read', resource: base })
    const second = await (
      await refresh(client.client_id, tokens.refresh_token)
    ).json<TokenResponse>()
    const third = await (
      await refresh(client.client_id, second.refresh_token)
    ).json<TokenResponse>()

    const stale = await refresh(client.client_id, tokens.refresh_token)

    expect(stale.status).toBe(400)
    expect(await stale.json<OAuthErrorBody>()).toEqual({
      error: 'invalid_grant',
      error_description: 'Invalid refresh token',
    })
    // No reuse detection: the stale token fails but the grant is not revoked.
    expect((await refresh(client.client_id, third.refresh_token)).status).toBe(200)
    expect((await send(`${base}/mcp`, bearer(third.access_token))).status).toBe(200)
  })

  it('does not revoke the access token of an earlier refresh: it lives until it expires or is revoked', async () => {
    const { client, tokens } = await signIn(send, base, { scope: 'content:read', resource: base })
    await refresh(client.client_id, tokens.refresh_token)

    expect(await wire(await send(`${base}/mcp`, bearer(tokens.access_token)))).toMatchObject({
      status: 200,
    })
  })
})
