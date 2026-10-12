import { env, exports } from 'cloudflare:workers'
import { createExecutionContext } from 'cloudflare:test'
import { OAuthProvider } from '@cloudflare/workers-oauth-provider'
import { describe, expect, it } from 'vitest'
import { apiHandler } from '../src/api.ts'
import { app } from '../src/app.ts'
import { authorize, bearer, register, signIn, wire, type Send } from './support/oauth.ts'

// O2. Fails when: providerOptions() (src/provider.ts) stops giving the provider absolute endpoint
// URLs and a canonical `resourceMetadata`, so that the issuer and the resource are no longer the
// configured public URL, or the provider starts answering from the Host header.

const send: Send = (input, init) => exports.default.fetch(input, init)
const base = 'https://hollware.test'
const other = 'https://evil.example'

const AUTHORIZATION_SERVER_METADATA = {
  issuer: 'https://hollware.test',
  authorization_endpoint: 'https://hollware.test/authorize',
  token_endpoint: 'https://hollware.test/oauth/token',
  protected_resources: ['https://hollware.test'],
  registration_endpoint: 'https://hollware.test/oauth/register',
  scopes_supported: [
    'content:read',
    'content:write',
    'content:publish',
    'schema:admin',
    'offline_access',
  ],
  response_types_supported: ['code'],
  response_modes_supported: ['query'],
  grant_types_supported: ['authorization_code', 'refresh_token'],
  token_endpoint_auth_methods_supported: [
    'client_secret_basic',
    'client_secret_post',
    'none',
    'private_key_jwt',
  ],
  token_endpoint_auth_signing_alg_values_supported: ['RS256', 'ES256'],
  revocation_endpoint: 'https://hollware.test/oauth/token',
  code_challenge_methods_supported: ['S256'],
  authorization_response_iss_parameter_supported: true,
  client_id_metadata_document_supported: true,
}

describe('authorization server metadata (RFC 8414)', () => {
  it('names the configured public URL as issuer and in every endpoint', async () => {
    const response = await send(`${base}/.well-known/oauth-authorization-server`)

    expect(response.status).toBe(200)
    expect(response.headers.get('Content-Type')).toBe('application/json')
    expect(await response.json()).toEqual(AUTHORIZATION_SERVER_METADATA)
  })

  it('answers the same document, with the same issuer, to a request that came through another host', async () => {
    const response = await send(`${other}/.well-known/oauth-authorization-server`)

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual(AUTHORIZATION_SERVER_METADATA)
  })

  it('takes the issuer from the request when the endpoints are configured as paths (what absolute URLs avoid)', async () => {
    const withPaths = new OAuthProvider<Env>({
      apiRoute: ['/mcp'],
      apiHandler,
      defaultHandler: app,
      authorizeEndpoint: '/authorize',
      tokenEndpoint: '/oauth/token',
      resourceMetadata: { resource: `${base}/mcp` },
    })
    const request = new Request(`${other}/.well-known/oauth-authorization-server`)

    const response = await withPaths.fetch(request, env, createExecutionContext())

    expect(await response.json()).toMatchObject({
      issuer: 'https://evil.example',
      authorization_endpoint: 'https://evil.example/authorize',
      token_endpoint: 'https://evil.example/oauth/token',
    })
  })
})

describe('protected resource metadata (RFC 9728)', () => {
  it('names the configured resource and the configured issuer', async () => {
    const response = await send(`${base}/.well-known/oauth-protected-resource`)

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({
      resource: 'https://hollware.test',
      authorization_servers: ['https://hollware.test'],
      scopes_supported: ['content:read'],
      bearer_methods_supported: ['header'],
      resource_name: 'Hollware spike',
    })
  })

  it('has no path-aware document for a resource that is the origin', async () => {
    expect(await wire(await send(`${base}/.well-known/oauth-protected-resource/mcp`))).toEqual({
      status: 404,
      wwwAuthenticate: null,
      cacheControl: null,
      body: '',
    })
  })

  it('is not served on another host', async () => {
    expect((await send(`${other}/.well-known/oauth-protected-resource`)).status).toBe(404)
  })
})

describe('a request that arrives through another host', () => {
  it('gets a challenge without resource_metadata', async () => {
    expect(await wire(await send(`${other}/mcp`))).toEqual({
      status: 401,
      wwwAuthenticate: 'Bearer realm="OAuth", scope="content:read"',
      cacheControl: 'no-store',
      body: '',
    })
  })

  it('does not reach the token or the registration endpoint', async () => {
    expect((await send(`${other}/oauth/token`, { method: 'POST' })).status).toBe(404)
    expect((await send(`${other}/oauth/register`, { method: 'POST', body: '{}' })).status).toBe(404)
  })

  it('refuses a valid access token: its audience is the configured resource', async () => {
    const { tokens } = await signIn(send, base, { scope: 'content:read', resource: base })

    expect(await wire(await send(`${other}/mcp`, bearer(tokens.access_token)))).toEqual({
      status: 401,
      wwwAuthenticate:
        'Bearer realm="OAuth", error="invalid_token", scope="content:read", error_description="Invalid audience"',
      cacheControl: 'no-store',
      body: '{"error":"invalid_token","error_description":"Token audience does not match resource server"}',
    })
  })

  it('still approves /authorize: the Worker has to guard that endpoint itself', async () => {
    const { client } = await signIn(send, base, { scope: 'content:read', resource: base })

    const response = await authorize(send, other, {
      clientId: client.client_id,
      scope: 'content:read',
      resource: base,
    })

    expect(response.status).toBe(302)
    expect(new URL(response.headers.get('Location') ?? '').searchParams.get('iss')).toBe(
      'https://hollware.test',
    )
  })
})

describe('the resource a client names (RFC 8707) when the resource is the origin', () => {
  async function redirectFor(resource: string): Promise<URL> {
    const client = await register(send, base)
    const response = await authorize(send, base, {
      clientId: client.client_id,
      scope: 'content:read',
      resource,
    })
    expect(response.status).toBe(302)
    return new URL(response.headers.get('Location') ?? '')
  }

  it.each([`${base}/`, 'https://HOLLWARE.test', `${base}?mode=direct`])(
    'accepts %s',
    async (resource) => {
      expect((await redirectFor(resource)).searchParams.get('code')).not.toBeNull()
    },
  )

  it.each([`${base}/mcp`, `${base}/mcp/`, `${base}:443`])(
    'refuses %s with invalid_target: the MCP URL itself is not the resource',
    async (resource) => {
      const location = await redirectFor(resource)

      expect(location.searchParams.get('error')).toBe('invalid_target')
      expect(location.searchParams.get('error_description')).toBe(
        'The resource parameter must name exactly one configured protected resource',
      )
    },
  )
})
