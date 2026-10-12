import type { Hono } from 'hono'
import type { AppEnv } from './app.ts'

/**
 * GET /__runtime: what this isolate has, plus the library at work in the same request.
 *
 * The Worker is configured with no_nodejs_compat and no_nodejs_compat_v2, so `process`, `Buffer` and
 * `setImmediate` must be undefined. The route then sends a real tools/call through the app's own
 * /mcp route (Hono 5 -> createMcpHandler -> McpServer -> Zod), so the answer proves the library ran
 * in the isolate that reported "undefined". A diagnostic for the spike, not a product route.
 */
export function mountRuntimeReport(app: Hono<AppEnv>): void {
  app.get('/__runtime', async (c) => {
    const globals: Record<string, unknown> = globalThis
    const call = await app.fetch(
      new Request(new URL('/mcp', c.req.url), {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          accept: 'application/json, text/event-stream',
          'mcp-protocol-version': '2026-07-28',
          'mcp-method': 'tools/call',
          'mcp-name': 'echo',
        },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          method: 'tools/call',
          params: {
            name: 'echo',
            arguments: { message: 'no node' },
            _meta: {
              'io.modelcontextprotocol/protocolVersion': '2026-07-28',
              'io.modelcontextprotocol/clientInfo': { name: 'runtime-report', version: '0.0.0' },
              'io.modelcontextprotocol/clientCapabilities': {},
            },
          },
        }),
      }),
      // A Request built inside the Worker carries no Host header, so the guard is off for this call.
      { ...c.env, ALLOWED_HOSTS: '' },
    )
    return c.json({
      globals: {
        process: typeof globals.process,
        Buffer: typeof globals.Buffer,
        setImmediate: typeof globals.setImmediate,
        require: typeof globals.require,
        userAgent: navigator.userAgent,
      },
      mcp: { status: call.status, body: await call.json() },
    })
  })
}
