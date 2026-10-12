import { createMcpHandler } from '@modelcontextprotocol/server'
import type { AuthInfo, McpRequestContext } from '@modelcontextprotocol/server'
import { describe, expect, it } from 'vitest'
import { createBaseApp } from '../../src/app.ts'
import { mcpRoute } from '../../src/mcp/route.ts'
import { buildScopedServer } from '../../src/mcp/server-scoped.ts'
import { legacyRpc, modernRpc } from './helpers.ts'

// What the Hono layer can hand to the SDK. Fails when: the factory stops seeing the era, the
// authInfo and the Request; handlers stop seeing authInfo; a tool scope stops answering 403 with
// the RFC 6750 challenge; or (the gotcha) a request WITHOUT authInfo stops being let through to the
// tool, which would mean scopeChallenge now enforces authentication by itself.

const reader: AuthInfo = { token: 'tok-r', clientId: 'client-a', scopes: ['content:read'] }
const writer: AuthInfo = {
  token: 'tok-w',
  clientId: 'client-b',
  scopes: ['content:read', 'content:write'],
}

type Seen = {
  era: string
  clientId: string | undefined
  isRequest: boolean
  url: string | undefined
}

function setup() {
  const seen: Seen[] = []
  const handler = createMcpHandler((context: McpRequestContext) => {
    seen.push({
      era: context.era,
      clientId: context.authInfo?.clientId,
      isRequest: context.requestInfo instanceof Request,
      url: context.requestInfo?.url,
    })
    return buildScopedServer(context)
  })
  const as = (authInfo: AuthInfo | undefined) => (request: Request) =>
    handler.fetch(request, authInfo ? { authInfo } : undefined)
  return { seen, as }
}

describe('what the factory and the handlers receive', () => {
  it('gives the factory the era, the authInfo passed to fetch, and the Request', async () => {
    const { seen, as } = setup()

    await modernRpc('tools/list', {}, 1, as(reader))
    await legacyRpc('tools/list', {}, 1, as(writer))

    expect(seen).toEqual([
      { era: 'modern', clientId: 'client-a', isRequest: true, url: 'http://spike.test/mcp' },
      { era: 'legacy', clientId: 'client-b', isRequest: true, url: 'http://spike.test/mcp' },
    ])
  })

  it('gives tool handlers the authInfo in ctx.http, in both eras', async () => {
    const { as } = setup()

    const modern = await modernRpc('tools/call', { name: 'whoami', arguments: {} }, 1, as(reader))
    const legacy = await legacyRpc('tools/call', { name: 'whoami', arguments: {} }, 1, as(writer))

    expect(modern.message.result).toMatchObject({
      content: [{ type: 'text', text: '{"clientId":"client-a","scopes":["content:read"]}' }],
    })
    expect(legacy.message.result).toEqual({
      content: [
        { type: 'text', text: '{"clientId":"client-b","scopes":["content:read","content:write"]}' },
      ],
    })
  })
})

describe('a tool scope (registerTool scopeChallenge: requireScopes)', () => {
  it.each([
    ['modern', modernRpc],
    ['legacy', legacyRpc],
  ])(
    'answers 403 with the RFC 6750 challenge to a token without it (%s era)',
    async (_era, rpc) => {
      const { as } = setup()

      const answer = await rpc('tools/call', { name: 'write_thing', arguments: {} }, 1, as(reader))

      expect(answer.status).toBe(403)
      expect(answer.text).toBe(
        '{"error":"insufficient_scope","error_description":"Insufficient scope"}',
      )
    },
  )

  it('sets WWW-Authenticate with the scope the token lacks', async () => {
    const { as } = setup()
    const response = await as(reader)(
      new Request('http://spike.test/mcp', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          accept: 'application/json, text/event-stream',
          'mcp-protocol-version': '2025-11-25',
        },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          method: 'tools/call',
          params: { name: 'write_thing', arguments: {} },
        }),
      }),
    )

    expect(response.status).toBe(403)
    expect(response.headers.get('www-authenticate')).toBe(
      'Bearer error="insufficient_scope", error_description="Insufficient scope", scope="content:write"',
    )
  })

  it('lets a token with the scope through', async () => {
    const { as } = setup()

    const answer = await modernRpc(
      'tools/call',
      { name: 'write_thing', arguments: {} },
      1,
      as(writer),
    )

    expect(answer.message.result).toMatchObject({ content: [{ type: 'text', text: 'written' }] })
  })

  it('does NOT stop a request without authInfo: the gateway must reject those itself', async () => {
    const { as } = setup()

    const answer = await modernRpc(
      'tools/call',
      { name: 'write_thing', arguments: {} },
      1,
      as(undefined),
    )

    expect(answer.status).toBe(200)
    expect(answer.message.result).toMatchObject({ content: [{ type: 'text', text: 'written' }] })
  })
})

describe('authInfo set by a Hono middleware (c.set) reaches the tools through the /mcp route', () => {
  const app = createBaseApp()
  app.use('/mcp', async (c, next) => {
    const scopes = c.req.header('x-test-scopes')
    if (scopes !== undefined) {
      c.set('authInfo', {
        token: 'test-token',
        clientId: 'test-client',
        scopes: scopes.split(','),
      })
    }
    await next()
  })
  app.all('/mcp', mcpRoute(buildScopedServer))
  const env = { APP_NAME: 'ctx-test', ALLOWED_HOSTS: '' }

  const call = (name: string, scopes: string) =>
    modernRpc('tools/call', { name, arguments: {} }, 1, (request) => {
      request.headers.set('x-test-scopes', scopes)
      return app.fetch(request, env)
    })

  it('hands the middleware authInfo to the handler', async () => {
    const answer = await call('whoami', 'content:read,content:write')

    expect(answer.message.result).toMatchObject({
      content: [
        {
          type: 'text',
          text: '{"clientId":"test-client","scopes":["content:read","content:write"]}',
        },
      ],
    })
  })

  it('enforces the tool scope against it', async () => {
    const denied = await call('write_thing', 'content:read')
    const allowed = await call('write_thing', 'content:write')

    expect(denied.status).toBe(403)
    expect(allowed.status).toBe(200)
  })
})
