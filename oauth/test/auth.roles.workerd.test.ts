import { exports } from 'cloudflare:workers'
import { afterEach, describe, expect, it } from 'vitest'
import { ROLE_SCOPES } from '../src/auth.ts'
import {
  bearer,
  signIn,
  tokenRequest,
  wire,
  type Send,
  type TokenResponse,
} from './support/oauth.ts'

// O3, O4 and O5 for the second topology. Fails when: createRoles() (src/roles.ts) stops
// validating tokens through authorizationServer.validateToken(), stops routing `hw_pat_` tokens
// to checkPersonalToken() inside the same hook, or the resource servers stop filling ctx.auth.

const send: Send = (input, init) => exports.default.fetch(input, init)
const base = 'https://hollware.test'
const mcp = `${base}/mcp`
const v1 = `${base}/v1`

const MCP_METADATA =
  'resource_metadata="https://hollware.test/.well-known/oauth-protected-resource/mcp"'
const V1_METADATA =
  'resource_metadata="https://hollware.test/.well-known/oauth-protected-resource/v1"'

describe('authorization code flow, bound to the resource', () => {
  it('reaches the apiHandler with the props of the grant and a ctx.auth bound to /mcp', async () => {
    const { client, tokens } = await signIn(send, base, {
      scope: 'content:read content:write',
      resource: mcp,
    })

    expect(tokens.resource).toBe('https://hollware.test/mcp')
    const response = await send(`${base}/mcp`, bearer(tokens.access_token))
    expect(await response.json()).toEqual({
      handler: 'mcp',
      method: 'GET',
      path: '/mcp',
      props: { userId: 'usr_spike', scopes: ['content:read', 'content:write'], via: 'oauth' },
      auth: {
        audience: 'https://hollware.test/mcp',
        scope: ['content:read', 'content:write'],
        userId: 'usr_spike',
        clientId: client.client_id,
      },
    })
  })

  it('keeps the resource of the grant when the refresh request does not name it, and rotates the token', async () => {
    const { client, tokens } = await signIn(send, base, { scope: 'content:read', resource: v1 })

    const response = await tokenRequest(send, base, {
      grant_type: 'refresh_token',
      refresh_token: tokens.refresh_token,
      client_id: client.client_id,
    })

    expect(response.status).toBe(200)
    const refreshed = await response.json<TokenResponse>()
    expect(refreshed.resource).toBe('https://hollware.test/v1')
    expect(refreshed.refresh_token).not.toBe(tokens.refresh_token)
    expect((await send(`${base}/v1/entries`, bearer(refreshed.access_token))).status).toBe(200)
    expect((await send(`${base}/mcp`, bearer(refreshed.access_token))).status).toBe(401)
  })
})

describe('errors', () => {
  it('answers a token without the needed scopes with the step-up challenge of the right resource', async () => {
    const mcpToken = await signIn(send, base, { scope: 'content:read', resource: mcp })
    const v1Token = await signIn(send, base, { scope: 'content:read content:write', resource: v1 })

    const write = await send(`${base}/mcp`, {
      method: 'POST',
      ...bearer(mcpToken.tokens.access_token),
    })
    const publish = await send(`${base}/v1/publish`, {
      method: 'POST',
      ...bearer(v1Token.tokens.access_token),
    })

    expect(await wire(write)).toEqual({
      status: 403,
      wwwAuthenticate: `Bearer realm="OAuth", error="insufficient_scope", scope="content:read content:write", ${MCP_METADATA}`,
      cacheControl: 'no-store',
      body: '{"error":"insufficient_scope"}',
    })
    expect(publish.headers.get('WWW-Authenticate')).toBe(
      `Bearer realm="OAuth", error="insufficient_scope", scope="content:read content:publish", ${V1_METADATA}`,
    )
  })

  it('answers an access token its client revoked (RFC 7009) with invalid_token', async () => {
    const { client, tokens } = await signIn(send, base, { scope: 'content:read', resource: mcp })

    await tokenRequest(send, base, {
      token: tokens.access_token,
      token_type_hint: 'access_token',
      client_id: client.client_id,
    })

    expect(await wire(await send(`${base}/mcp`, bearer(tokens.access_token)))).toEqual({
      status: 401,
      wwwAuthenticate: `Bearer realm="OAuth", ${MCP_METADATA}, error="invalid_token", scope="content:read"`,
      cacheControl: 'no-store',
      body: '',
    })
  })
})

describe('personal tokens through validateToken', () => {
  it('hands the props of a valid hw_pat_ token to the apiHandler, with a ctx.auth the hook filled', async () => {
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
      auth: {
        audience: 'https://hollware.test/mcp',
        scope: ['content:read', 'content:write'],
        userId: 'usr_pat',
        clientId: 'pat:tok_test',
      },
    })
  })

  it('is valid at the other resource too: the hook receives the resource it is asked about', async () => {
    const response = await send(`${base}/v1/entries`, bearer('hw_pat_test'))

    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({
      handler: 'v1',
      auth: { audience: 'https://hollware.test/v1', scope: ['content:read', 'content:write'] },
    })
  })

  it('enforces the scopes of the token with the same insufficientScope() the OAuth tokens get', async () => {
    const publish = await send(`${base}/v1/publish`, { method: 'POST', ...bearer('hw_pat_test') })

    expect(await wire(publish)).toEqual({
      status: 403,
      wwwAuthenticate: `Bearer realm="OAuth", error="insufficient_scope", scope="content:read content:publish", ${V1_METADATA}`,
      cacheControl: 'no-store',
      body: '{"error":"insufficient_scope"}',
    })
  })

  it('answers an unknown hw_pat_ token with 401 invalid_token', async () => {
    expect(await wire(await send(`${base}/mcp`, bearer('hw_pat_unknown')))).toEqual({
      status: 401,
      wwwAuthenticate: `Bearer realm="OAuth", ${MCP_METADATA}, error="invalid_token", scope="content:read"`,
      cacheControl: 'no-store',
      body: '',
    })
  })

  it.each([
    ['hw_pat_expired', 'Personal token expired'],
    ['hw_pat_revoked', 'Personal token revoked'],
  ])('says why %s is refused, through OAuthError', async (token, description) => {
    expect(await wire(await send(`${base}/mcp`, bearer(token)))).toEqual({
      status: 401,
      wwwAuthenticate: `Bearer realm="OAuth", ${MCP_METADATA}, error="invalid_token", scope="content:read"`,
      cacheControl: 'no-store',
      body: JSON.stringify({ error: 'invalid_token', error_description: description }),
    })
  })
})

describe('effective scopes = token ∩ the current role of its user', () => {
  const roles = { ...ROLE_SCOPES }
  afterEach(() => {
    Object.assign(ROLE_SCOPES, roles)
  })

  it('takes a scope away from a token already issued when its user loses it, with no new token', async () => {
    const { tokens } = await signIn(send, base, {
      scope: 'content:read content:write content:publish',
      resource: v1,
    })
    const publish = () =>
      send(`${base}/v1/publish`, { method: 'POST', ...bearer(tokens.access_token) })
    expect((await publish()).status).toBe(200)

    ROLE_SCOPES.usr_spike = ['content:read', 'content:write']

    const refused = await publish()
    expect(refused.status).toBe(403)
    expect(refused.headers.get('WWW-Authenticate')).toBe(
      `Bearer realm="OAuth", error="insufficient_scope", scope="content:read content:publish", ${V1_METADATA}`,
    )
    // The token still carries publish; what the request may do is the intersection.
    const read = await send(`${base}/v1/entries`, bearer(tokens.access_token))
    expect(await read.json()).toMatchObject({
      props: { scopes: ['content:read', 'content:write', 'content:publish'] },
      auth: { scope: ['content:read', 'content:write'] },
    })
  })

  it('does the same for a personal token', async () => {
    expect((await send(`${base}/mcp`, { method: 'POST', ...bearer('hw_pat_test') })).status).toBe(
      200,
    )

    ROLE_SCOPES.usr_pat = ['content:read']

    const refused = await send(`${base}/mcp`, { method: 'POST', ...bearer('hw_pat_test') })
    expect(refused.status).toBe(403)
    expect(refused.headers.get('WWW-Authenticate')).toBe(
      `Bearer realm="OAuth", error="insufficient_scope", scope="content:read content:write", ${MCP_METADATA}`,
    )
  })

  it('lets a user with no role do nothing', async () => {
    const { tokens } = await signIn(send, base, { scope: 'content:read', resource: mcp })
    ROLE_SCOPES.usr_spike = []

    expect((await send(`${base}/mcp`, bearer(tokens.access_token))).status).toBe(403)
  })
})
