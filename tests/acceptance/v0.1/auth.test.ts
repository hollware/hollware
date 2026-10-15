import { afterAll, beforeAll, describe, expect, it } from 'vite-plus/test'

import {
  createHarnessWithoutPublicUrl,
  createPlaygroundHarness,
  HOLLWARE_URL,
  migrate,
  seedOwnerToken,
  seedToken,
} from './support/harness.ts'

// Fails when: the built playground stops guarding its MCP endpoint the way AC-0.1-6 describes:
// a request without a token, or with one that nobody issued, that expired or that was revoked,
// stops getting 401 with its challenge; a token without the scope of a tool stops getting 403 with
// the challenge that names the scope; a request for another Host or with another Origin stops
// getting 403; or a deployment without HOLLWARE_PUBLIC_URL starts answering anything but 500.

const server = createPlaygroundHarness()
const tokens = { owner: '', reader: '', expired: '', revoked: '' }

const ALL_SCOPES = ['content:read', 'content:write', 'content:publish', 'schema:admin']

beforeAll(async () => {
  await server.listen()
  await migrate(server)
  tokens.owner = await seedOwnerToken(server)
  tokens.reader = await seedToken(server, { scopes: ['content:read'] })
  tokens.expired = await seedToken(server, {
    scopes: ALL_SCOPES,
    expiresAt: '2026-01-01T00:00:00.000Z',
  })
  tokens.revoked = await seedToken(server, {
    scopes: ALL_SCOPES,
    revokedAt: '2026-10-01T00:00:00.000Z',
  })
})

afterAll(async () => {
  await server.close()
})

/** A `tools/call` of the 2026 era, sent to Hollware with the headers a test chooses. */
function call(tool: string, args: object, headers: Record<string, string> = {}) {
  return server.fetch(`${HOLLWARE_URL}/mcp`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      accept: 'application/json, text/event-stream',
      'mcp-protocol-version': '2026-07-28',
      'mcp-method': 'tools/call',
      'mcp-name': tool,
      ...headers,
    },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'tools/call',
      params: {
        name: tool,
        arguments: args,
        _meta: {
          'io.modelcontextprotocol/protocolVersion': '2026-07-28',
          'io.modelcontextprotocol/clientInfo': { name: 'acceptance', version: '0.1.0' },
          'io.modelcontextprotocol/clientCapabilities': {},
        },
      },
    }),
  })
}

const bearer = (token: string) => ({ authorization: `Bearer ${token}` })

const DRAFT = {
  collection: 'blog',
  locale: 'en',
  slug: 'scoped-out',
  markdown:
    '---\ntitle: Scoped out\ndescription: A draft a reader may not write.\ndate: 2026-10-13\ntags:\n  - cms\ntranslationGroup: scoped-out\n---\n\nText.\n',
}

describe('AC-0.1-6: who may reach the MCP endpoint', () => {
  it('serves the owner', async () => {
    const response = await call('describe_site', {}, bearer(tokens.owner))

    expect(response.status).toBe(200)
  })

  it('answers 401 with the Bearer challenge to a request without a token', async () => {
    const response = await call('describe_site', {})

    expect([response.status, response.headers.get('www-authenticate')]).toEqual([
      401,
      `Bearer realm="hollware", resource_metadata="${HOLLWARE_URL}/.well-known/oauth-protected-resource/mcp", scope="content:read"`,
    ])
  })

  it.each([
    ['nobody issued', 'hw_pat_zzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzz'],
    ['expired', 'expired'],
    ['revoked', 'revoked'],
  ])('answers 401 invalid_token to a token that %s', async (_case, which) => {
    const token = which === 'expired' || which === 'revoked' ? tokens[which] : which

    const response = await call('describe_site', {}, bearer(token))

    expect([response.status, response.headers.get('www-authenticate')]).toEqual([
      401,
      `Bearer realm="hollware", resource_metadata="${HOLLWARE_URL}/.well-known/oauth-protected-resource/mcp", error="invalid_token", scope="content:read"`,
    ])
  })

  it('answers 403 naming content:write to a reader that calls create_draft, and serves it a read', async () => {
    const write = await call('create_draft', DRAFT, bearer(tokens.reader))
    const read = await call('describe_site', {}, bearer(tokens.reader))

    expect([write.status, write.headers.get('www-authenticate')]).toEqual([
      403,
      `Bearer error="insufficient_scope", error_description="create_draft requires: content:write", scope="content:write", resource_metadata="${HOLLWARE_URL}/.well-known/oauth-protected-resource/mcp"`,
    ])
    expect(read.status).toBe(200)
  })

  it('answers 403 forbidden_host to a request for another Host', async () => {
    const response = await server.fetch('http://evil.example.com/mcp', {
      method: 'POST',
      headers: bearer(tokens.owner),
    })

    expect(response.status).toBe(403)
    expect(await response.json()).toMatchObject({ code: 'forbidden_host' })
  })

  it('answers 403 forbidden_origin to a request with another Origin', async () => {
    const response = await call(
      'describe_site',
      {},
      {
        ...bearer(tokens.owner),
        origin: 'http://evil.example.com',
      },
    )

    expect(response.status).toBe(403)
    expect(await response.json()).toMatchObject({ code: 'forbidden_origin' })
  })

  it('answers 500 misconfigured to everything when HOLLWARE_PUBLIC_URL is missing', async () => {
    const { server: misconfigured, remove } = createHarnessWithoutPublicUrl()
    try {
      await misconfigured.listen()
      const health = await misconfigured.fetch(`${HOLLWARE_URL}/health`)
      const mcp = await misconfigured.fetch(`${HOLLWARE_URL}/mcp`, {
        method: 'POST',
        headers: bearer(tokens.owner),
      })

      expect([health.status, mcp.status]).toEqual([500, 500])
      expect(await health.json()).toMatchObject({ code: 'misconfigured' })
    } finally {
      await misconfigured.close()
      remove()
    }
  })
})
