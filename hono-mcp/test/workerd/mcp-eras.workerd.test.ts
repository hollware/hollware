import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client'
import type { VersionNegotiationOptions } from '@modelcontextprotocol/client'
import { describe, expect, it } from 'vitest'
import { MCP_URL, legacyRpc, recordingFetch } from './helpers.ts'
import type { Exchange } from './helpers.ts'

// S2a / S2b. Fails when: createMcpHandler stops serving both eras from the one /mcp route, the
// 2026-07-28 exchange starts needing a session or an initialize, the 2025-11-25 exchange stops being
// the initialize -> tools/list -> tools/call sequence, or the era markers on the wire change:
//   2026-07-28: Mcp-Protocol-Version: 2026-07-28 + Mcp-Method headers, `_meta` envelope in the body,
//               application/json answers, no initialize, no Mcp-Session-Id.
//   2025-11-25: initialize with protocolVersion 2025-11-25, then Mcp-Protocol-Version: 2025-11-25,
//               text/event-stream answers, no Mcp-Session-Id (stateless fallback).

async function connect(versionNegotiation?: VersionNegotiationOptions) {
  const log: Exchange[] = []
  const client = new Client(
    { name: 'era-test-client', version: '0.0.0' },
    versionNegotiation ? { versionNegotiation } : {},
  )
  await client.connect(
    new StreamableHTTPClientTransport(new URL(MCP_URL), { fetch: recordingFetch(log) }),
  )
  return { client, log }
}

const wireMethods = (log: Exchange[]) =>
  log.map((exchange) => exchange.request.body?.method ?? exchange.request.method)

describe('a 2026-07-28 client (stateless, no session)', () => {
  it('discovers, lists and calls over plain JSON with the per-request envelope', async () => {
    const { client, log } = await connect({ mode: { pin: '2026-07-28' } })

    expect(client.getProtocolEra()).toBe('modern')
    expect(client.getNegotiatedProtocolVersion()).toBe('2026-07-28')

    const listed = await client.listTools()
    expect(listed.tools.map((tool) => tool.name)).toEqual(['always_fails', 'create_note', 'echo'])
    const called = await client.callTool({ name: 'echo', arguments: { message: 'hi' } })
    expect(called.structuredContent).toEqual({ echoed: 'hi', length: 2 })
    expect(called.isError).toBeUndefined()

    // How we know it was the 2026 era: no initialize, a discover probe first, the envelope in
    // every body, the protocol header on every request, and no session anywhere.
    expect(wireMethods(log)).toEqual(['server/discover', 'tools/list', 'tools/call'])
    for (const { request, response } of log) {
      expect(request.method).toBe('POST')
      expect(request.headers['mcp-protocol-version']).toBe('2026-07-28')
      expect(request.headers['mcp-session-id']).toBeUndefined()
      expect(response.headers['mcp-session-id']).toBeUndefined()
      expect(response.status).toBe(200)
      expect(response.headers['content-type']).toBe('application/json')
      expect(request.body?.params).toMatchObject({
        _meta: {
          'io.modelcontextprotocol/protocolVersion': '2026-07-28',
          'io.modelcontextprotocol/clientInfo': { name: 'era-test-client', version: '0.0.0' },
          'io.modelcontextprotocol/clientCapabilities': {},
        },
      })
    }
    expect(log.map(({ request }) => request.headers['mcp-method'])).toEqual([
      'server/discover',
      'tools/list',
      'tools/call',
    ])
    expect(log[2]?.request.headers['mcp-name']).toBe('echo')

    const discover = JSON.parse(log[0]?.response.text ?? 'null')
    expect(discover.result).toEqual({
      supportedVersions: ['2026-07-28'],
      capabilities: { tools: { listChanged: false } },
      resultType: 'complete',
      ttlMs: 0,
      cacheScope: 'private',
      _meta: { 'io.modelcontextprotocol/serverInfo': { name: 'spike-hono-mcp', version: '0.0.0' } },
    })
    await client.close()
  })

  it('is what a client that probes (mode auto) ends up on', async () => {
    const { client, log } = await connect({ mode: 'auto' })

    expect(client.getProtocolEra()).toBe('modern')
    expect(wireMethods(log)).toEqual(['server/discover'])
    await client.close()
  })
})

describe('a 2025-11-25 client (initialize -> tools/list -> tools/call)', () => {
  it('initializes, lists and calls without ever getting a session', async () => {
    const { client, log } = await connect()

    expect(client.getProtocolEra()).toBe('legacy')
    expect(client.getNegotiatedProtocolVersion()).toBe('2025-11-25')
    expect(client.getServerVersion()).toEqual({ name: 'spike-hono-mcp', version: '0.0.0' })

    const listed = await client.listTools()
    expect(listed.tools.map((tool) => tool.name)).toEqual(['always_fails', 'create_note', 'echo'])
    const called = await client.callTool({ name: 'echo', arguments: { message: 'hi' } })
    expect(called.structuredContent).toEqual({ echoed: 'hi', length: 2 })

    // How we know it was the 2025 era: the initialize handshake, then the version header; answers
    // arrive as an SSE event; the stateless fallback never issues a session id and answers the
    // client's optional GET stream with 405.
    expect(wireMethods(log)).toEqual([
      'initialize',
      'notifications/initialized',
      'GET',
      'tools/list',
      'tools/call',
    ])
    expect(log[0]?.request.body?.params).toEqual({
      protocolVersion: '2025-11-25',
      capabilities: {},
      clientInfo: { name: 'era-test-client', version: '0.0.0' },
    })
    expect(log[0]?.request.headers['mcp-protocol-version']).toBeUndefined()
    expect(log[3]?.request.headers['mcp-protocol-version']).toBe('2025-11-25')
    expect(log.map(({ response }) => response.status)).toEqual([200, 202, 405, 200, 200])
    expect(log[0]?.response.headers['content-type']).toBe('text/event-stream')
    expect(log[3]?.response.headers['content-type']).toBe('text/event-stream')
    for (const { request, response } of log) {
      expect(request.headers['mcp-session-id']).toBeUndefined()
      expect(response.headers['mcp-session-id']).toBeUndefined()
    }
    expect(log[0]?.response.text).toBe(
      'event: message\n' +
        'data: {"result":{"protocolVersion":"2025-11-25","capabilities":{"tools":{"listChanged":false}},' +
        '"serverInfo":{"name":"spike-hono-mcp","version":"0.0.0"}},"jsonrpc":"2.0","id":0}\n\n',
    )
    await client.close()
  })

  it('negotiates down for an older 2025 client', async () => {
    const initialized = await legacyRpc('initialize', {
      protocolVersion: '2025-06-18',
      capabilities: {},
      clientInfo: { name: 'older-client', version: '0.0.0' },
    })

    expect(initialized.message.result).toEqual({
      protocolVersion: '2025-06-18',
      capabilities: { tools: { listChanged: false } },
      serverInfo: { name: 'spike-hono-mcp', version: '0.0.0' },
    })
  })

  it('serves a tools/call that was never preceded by initialize', async () => {
    const called = await legacyRpc('tools/call', { name: 'echo', arguments: { message: 'hey' } })

    expect(called.status).toBe(200)
    expect(called.message.result).toEqual({
      content: [{ type: 'text', text: '{"echoed":"hey","length":3}' }],
      structuredContent: { echoed: 'hey', length: 3 },
    })
  })
})
