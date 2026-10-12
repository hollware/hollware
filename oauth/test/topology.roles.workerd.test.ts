import { exports } from 'cloudflare:workers'
import { describe, expect, it } from 'vitest'
import { authorize, bearer, register, signIn, wire, type Send } from './support/oauth.ts'

// O1 and O2 for the second topology. Fails when: createRoles() (src/roles.ts) stops declaring
// /mcp and /v1 as two resources of one authorization server, stops routing them to their own
// OAuthResourceServer, or the library stops answering only for the configured origin.

const send: Send = (input, init) => exports.default.fetch(input, init)
const base = 'https://hollware.test'
const mcp = `${base}/mcp`
const v1 = `${base}/v1`
const other = 'https://evil.example'

const BASELINE = 'scope="content:read"'

describe('authorization server metadata', () => {
  it('lists both resources and names the configured public URL as issuer', async () => {
    const response = await send(`${base}/.well-known/oauth-authorization-server`)

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({
      issuer: 'https://hollware.test',
      authorization_endpoint: 'https://hollware.test/authorize',
      token_endpoint: 'https://hollware.test/oauth/token',
      protected_resources: ['https://hollware.test/mcp', 'https://hollware.test/v1'],
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
    })
  })
})

describe('protected resource metadata, one document per resource (RFC 9728)', () => {
  it.each([
    ['mcp', 'Hollware spike MCP'],
    ['v1', 'Hollware spike HTTP API'],
  ])('serves the document of /%s at its path-aware well-known URL', async (name, resourceName) => {
    const response = await send(`${base}/.well-known/oauth-protected-resource/${name}`)

    expect(response.status).toBe(200)
    expect(response.headers.get('Cache-Control')).toBe('no-store')
    expect(await response.json()).toEqual({
      resource: `https://hollware.test/${name}`,
      authorization_servers: ['https://hollware.test'],
      scopes_supported: ['content:read'],
      bearer_methods_supported: ['header'],
      resource_name: resourceName,
    })
  })

  it('has no document at the root well-known URL: nothing is a resource there', async () => {
    expect((await send(`${base}/.well-known/oauth-protected-resource`)).status).toBe(404)
  })
})

describe('two resources in one Worker', () => {
  it.each([
    ['/mcp', 'mcp'],
    ['/mcp/tools', 'mcp'],
    ['/v1', 'v1'],
    ['/v1/entries', 'v1'],
  ])('answers %s with the challenge that names its own metadata', async (path, name) => {
    expect(await wire(await send(`${base}${path}`))).toEqual({
      status: 401,
      wwwAuthenticate: `Bearer realm="OAuth", resource_metadata="https://hollware.test/.well-known/oauth-protected-resource/${name}", ${BASELINE}`,
      cacheControl: 'no-store',
      body: '',
    })
  })

  it('keeps serving a public route from Hono', async () => {
    expect(await wire(await send(`${base}/`))).toMatchObject({
      status: 200,
      body: '{"name":"hollware-spike-oauth-roles","public":true}',
    })
  })

  it('binds a token to one resource: the token of /mcp is refused at /v1 and the other way round', async () => {
    const forMcp = await signIn(send, base, { scope: 'content:read', resource: mcp })
    const forV1 = await signIn(send, base, { scope: 'content:read', resource: v1 })

    expect((await send(`${base}/mcp`, bearer(forMcp.tokens.access_token))).status).toBe(200)
    expect((await send(`${base}/v1/entries`, bearer(forV1.tokens.access_token))).status).toBe(200)
    expect(
      await wire(await send(`${base}/v1/entries`, bearer(forMcp.tokens.access_token))),
    ).toEqual({
      status: 401,
      wwwAuthenticate: `Bearer realm="OAuth", resource_metadata="https://hollware.test/.well-known/oauth-protected-resource/v1", error="invalid_token", ${BASELINE}`,
      cacheControl: 'no-store',
      body: '',
    })
    expect((await send(`${base}/mcp`, bearer(forV1.tokens.access_token))).status).toBe(401)
  })

  it('refuses an authorization request that does not name one of the two resources', async () => {
    const client = await register(send, base)

    const response = await authorize(send, base, {
      clientId: client.client_id,
      scope: 'content:read',
      resource: null,
    })

    expect(response.status).toBe(302)
    const location = new URL(response.headers.get('Location') ?? '')
    expect(location.searchParams.get('error')).toBe('invalid_target')
    expect(location.searchParams.get('error_description')).toBe(
      'The resource parameter is required when the authorization server has multiple resources',
    )
  })
})

describe('a request that arrives through another host', () => {
  it.each([
    '/.well-known/oauth-authorization-server',
    '/.well-known/oauth-protected-resource/mcp',
    '/mcp',
    '/v1/entries',
  ])('gets a 404 for %s: the objects answer only for the configured origin', async (path) => {
    expect(await wire(await send(`${other}${path}`))).toEqual({
      status: 404,
      wwwAuthenticate: null,
      cacheControl: null,
      body: '',
    })
  })

  it('does not reach the token endpoint', async () => {
    expect((await send(`${other}/oauth/token`, { method: 'POST' })).status).toBe(404)
  })

  it('refuses /authorize: parseAuthRequest() only accepts the advertised endpoint', async () => {
    const client = await register(send, base)

    const response = await authorize(send, other, {
      clientId: client.client_id,
      scope: 'content:read',
      resource: mcp,
    })

    expect(await wire(response)).toMatchObject({
      status: 400,
      body: 'Authorization request was sent to an unconfigured endpoint',
    })
  })
})

describe('the resource a client names (RFC 8707) when each endpoint is a resource', () => {
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

  it.each([mcp, v1])(
    'accepts the endpoint URL %s, which is what a client connects to',
    async (resource) => {
      expect((await redirectFor(resource)).searchParams.get('code')).not.toBeNull()
    },
  )

  it.each([base, `${base}/`, `${mcp}/`])('refuses %s with invalid_target', async (resource) => {
    const location = await redirectFor(resource)

    expect(location.searchParams.get('error')).toBe('invalid_target')
    expect(location.searchParams.get('error_description')).toBe(
      'The resource parameter must name exactly one configured protected resource',
    )
  })
})
