import {
  createMcpHandler,
  hostHeaderValidationResponse,
  originValidationResponse,
} from '@modelcontextprotocol/server'
import type { McpServerFactory } from '@modelcontextprotocol/server'
import type { Context } from 'hono'
import type { AppEnv } from '../app.ts'

/** "localhost,127.0.0.1" -> ["localhost", "127.0.0.1"]. Empty or unset: validation is off. */
export function parseAllowedHosts(value: string | undefined): string[] {
  return (value ?? '')
    .split(',')
    .map((host) => host.trim())
    .filter((host) => host !== '')
}

/**
 * The Hono handler for /mcp WITHOUT @modelcontextprotocol/hono: `handler.fetch` takes the raw
 * Request. One handler per isolate; the factory still builds a fresh McpServer for every request.
 */
export function mcpRoute(factory: McpServerFactory) {
  const mcp = createMcpHandler(factory)
  return (c: Context<AppEnv>): Promise<Response> | Response => {
    // The handler is deliberately validation-free. DNS rebinding protection is the host's job.
    const allowed = parseAllowedHosts(c.env.ALLOWED_HOSTS)
    if (allowed.length > 0) {
      const rejected =
        hostHeaderValidationResponse(c.req.raw, allowed) ??
        originValidationResponse(c.req.raw, allowed)
      if (rejected) return rejected
    }
    // authInfo comes from a Hono middleware (token verification); the SDK never derives it itself.
    const authInfo = c.get('authInfo')
    return mcp.fetch(c.req.raw, authInfo ? { authInfo } : undefined)
  }
}
