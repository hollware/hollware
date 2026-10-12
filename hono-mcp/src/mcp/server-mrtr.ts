import {
  McpServer,
  acceptedContent,
  inputRequired,
  inputResponse,
} from '@modelcontextprotocol/server'
import * as z from 'zod'

// A confirmation as a multi round-trip request (MRTR): the shape ADR-012 plans for `publish`. A
// "write-once" handler: the first call asks, the retry (inputResponses) acts. Test-only: it lives
// outside the Worker bundle (nothing in src/index.ts imports it).

const confirmation = z.object({ confirm: z.boolean() })

export function buildMrtrServer(): McpServer {
  const server = new McpServer({ name: 'spike-mrtr', version: '0.0.0' })
  server.registerTool(
    'confirm_delete',
    {
      description: 'Deletes after asking the human to confirm.',
      inputSchema: z.object({ id: z.string() }),
      annotations: { destructiveHint: true },
    },
    ({ id }, ctx) => {
      const answer = inputResponse(ctx.mcpReq.inputResponses, 'confirm')
      // A decline or cancel must end the exchange. Asking again makes the client retry until
      // inputRequired.maxRounds (10) and then throw.
      if (answer.kind === 'elicit' && answer.action !== 'accept') {
        return { content: [{ type: 'text', text: `kept ${id}` }] }
      }
      if (acceptedContent(ctx.mcpReq.inputResponses, 'confirm', confirmation)?.confirm === true) {
        return { content: [{ type: 'text', text: `deleted ${id}` }] }
      }
      return inputRequired({
        inputRequests: {
          confirm: inputRequired.elicit({
            message: `Delete ${id}?`,
            requestedSchema: confirmation,
          }),
        },
      })
    },
  )

  // The same tool without the decline check: what a naive handler does.
  server.registerTool(
    'naive_delete',
    { description: 'Asks again after a decline.', inputSchema: z.object({ id: z.string() }) },
    ({ id }, ctx) => {
      if (acceptedContent(ctx.mcpReq.inputResponses, 'confirm', confirmation)?.confirm === true) {
        return { content: [{ type: 'text', text: `deleted ${id}` }] }
      }
      return inputRequired({
        inputRequests: {
          confirm: inputRequired.elicit({
            message: `Delete ${id}?`,
            requestedSchema: confirmation,
          }),
        },
      })
    },
  )
  return server
}
