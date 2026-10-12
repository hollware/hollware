import { McpServer, requireScopes } from '@modelcontextprotocol/server'
import type { McpRequestContext } from '@modelcontextprotocol/server'
import * as z from 'zod'

/** Two tools for the authInfo and scope checks: one open, one that needs `content:write`. */
export function buildScopedServer(_context?: McpRequestContext): McpServer {
  const server = new McpServer({ name: 'ctx', version: '0' })
  server.registerTool('whoami', { inputSchema: z.object({}) }, (_input, ctx) => ({
    content: [
      {
        type: 'text',
        text: JSON.stringify({
          clientId: ctx.http?.authInfo?.clientId,
          scopes: ctx.http?.authInfo?.scopes,
        }),
      },
    ],
  }))
  server.registerTool(
    'write_thing',
    { inputSchema: z.object({}), scopeChallenge: requireScopes('content:write') },
    () => ({ content: [{ type: 'text', text: 'written' }] }),
  )
  return server
}
