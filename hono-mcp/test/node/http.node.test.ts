import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client'
import { describe, expect, it } from 'vite-plus/test'

// Runs against a REAL server, started by the caller, so the Worker executes in a real workerd
// (where `new Function` is forbidden), not in the vitest runtime:
//   MCP_URL=http://localhost:5201/mcp vp test --root ../.. --project 'spike-hono-mcp:node' http
// Skipped when MCP_URL is not set. The vitest workerd runner always turns Node.js compatibility on,
// so only a real workerd over the BUILT Worker (wrangler dev -c dist/.../wrangler.json) can prove that
// the library runs without Node. Fails when: either protocol era stops working over real HTTP, the
// tool error text changes between the vitest runtime and a real workerd (Zod non-JIT path), or the
// Host guard stops answering 403.

const url = process.env.MCP_URL

describe.skipIf(url === undefined)('the /mcp route over real HTTP', () => {
  const endpoint = new URL(url ?? 'http://localhost:0/mcp')

  it('serves a 2026-07-28 client (pinned)', async () => {
    const client = new Client(
      { name: 'http-test', version: '0.0.0' },
      { versionNegotiation: { mode: { pin: '2026-07-28' } } },
    )
    await client.connect(new StreamableHTTPClientTransport(endpoint))

    expect(client.getProtocolEra()).toBe('modern')
    expect((await client.listTools()).tools.map((tool) => tool.name)).toEqual([
      'always_fails',
      'create_note',
      'echo',
    ])
    expect(
      (await client.callTool({ name: 'echo', arguments: { message: 'hi' } })).structuredContent,
    ).toEqual({
      echoed: 'hi',
      length: 2,
    })
    await client.close()
  })

  it('serves a 2025-11-25 client (initialize first)', async () => {
    const client = new Client({ name: 'http-test', version: '0.0.0' })
    await client.connect(new StreamableHTTPClientTransport(endpoint))

    expect(client.getProtocolEra()).toBe('legacy')
    expect(client.getNegotiatedProtocolVersion()).toBe('2025-11-25')
    expect(
      (await client.callTool({ name: 'echo', arguments: { message: 'hi' } })).structuredContent,
    ).toEqual({
      echoed: 'hi',
      length: 2,
    })
    await client.close()
  })

  it('reports invalid input as a tool error, with the same text as inside the vitest runtime', async () => {
    const client = new Client(
      { name: 'http-test', version: '0.0.0' },
      { versionNegotiation: { mode: { pin: '2026-07-28' } } },
    )
    await client.connect(new StreamableHTTPClientTransport(endpoint))

    const result = await client.callTool({ name: 'echo', arguments: { message: '' } })

    expect(result.isError).toBe(true)
    expect(result.content).toEqual([
      {
        type: 'text',
        text: 'Input validation error: Invalid arguments for tool echo: message: Too small: expected string to have >=1 characters',
      },
    ])
    await client.close()
  })

  it('applies the Zod default of create_note', async () => {
    const client = new Client(
      { name: 'http-test', version: '0.0.0' },
      { versionNegotiation: { mode: { pin: '2026-07-28' } } },
    )
    await client.connect(new StreamableHTTPClientTransport(endpoint))

    const result = await client.callTool({
      name: 'create_note',
      arguments: { title: 'Over HTTP', body: 'b' },
    })

    expect(result.structuredContent).toEqual({
      outcome: 'created',
      note: { id: 'note-over-http', title: 'Over HTTP', version: 1, tags: [] },
    })
    await client.close()
  })

  it('runs with no Node.js globals (no_nodejs_compat, no_nodejs_compat_v2) and still serves the library', async () => {
    const response = await fetch(new URL('/__runtime', endpoint))
    const report = JSON.parse(await response.text())

    expect(response.status).toBe(200)
    expect(report.globals).toEqual({
      process: 'undefined',
      Buffer: 'undefined',
      setImmediate: 'undefined',
      require: 'undefined',
      userAgent: 'Cloudflare-Workers',
    })
    expect(report.mcp.status).toBe(200)
    expect(report.mcp.body.result.structuredContent).toEqual({ echoed: 'no node', length: 7 })
  })

  it('answers 4xx to a foreign Host header (DNS rebinding)', async () => {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        host: 'evil.example.com',
        origin: 'http://evil.example.com',
        'content-type': 'application/json',
        accept: 'application/json, text/event-stream',
      },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'ping' }),
    })

    expect(response.status).toBe(403)
  })
})
