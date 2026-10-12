import { McpServer } from '@modelcontextprotocol/server'
import type { McpRequestContext } from '@modelcontextprotocol/server'
import * as z from 'zod'

/**
 * A tool that reports progress while it runs: three notifications/progress, 20 ms apart, then the
 * result. `onFinished` lets a test see whether the client got the notifications before the handler
 * returned. Test and extras Worker only; nothing in src/index.ts imports it.
 */
export function buildProgressServer(
  _context?: McpRequestContext,
  onFinished?: () => void,
): McpServer {
  const server = new McpServer({ name: 'progress', version: '0.0.0' })
  server.registerTool('slow', { inputSchema: z.object({}) }, async (_input, ctx) => {
    const progressToken = ctx.mcpReq._meta?.progressToken
    for (const step of [1, 2, 3]) {
      if (progressToken !== undefined) {
        await ctx.mcpReq.notify({
          method: 'notifications/progress',
          params: { progressToken, progress: step, total: 3, message: `step ${step}` },
        })
      }
      await new Promise((resolve) => setTimeout(resolve, 20))
    }
    onFinished?.()
    return { content: [{ type: 'text', text: 'done' }] }
  })
  return server
}
