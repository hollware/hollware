import * as z from 'zod'
import { hollwareEvent, type HollwareEvent } from './events.ts'
import { SCOPES } from './scopes.ts'
import { verifyWebhook } from './webhooks.ts'

/** What an agent gets with each event: a token that acts as its member for an hour, and where. */
export const agentGrant = z.object({
  token: z.string().describe('The grant (hw_agt_…), a bearer token for /mcp and /v1/ops.'),
  expiresAt: z.string().describe('When it stops working, as an ISO 8601 timestamp.'),
  scopes: z.array(z.enum(SCOPES)).describe('What it may do: those of the subscription.'),
  review: z
    .string()
    .nullable()
    .describe(
      'With review.requested, the review it is for: it reads and comments on that review only, and stops working once the review is decided.',
    ),
  mcp: z.string().describe('The MCP endpoint of Hollware.'),
  ops: z.string().describe('The operations endpoint of Hollware: POST <ops>/<name>.'),
})

/** The body of a delivery to an agent's webhook, signed as every webhook of Hollware is. */
export const agentDelivery = z.object({
  agent: z.string().describe('The name of the agent, as the site declares it.'),
  event: hollwareEvent,
  grant: agentGrant,
})

export type AgentGrant = z.infer<typeof agentGrant>
export type AgentDelivery = z.infer<typeof agentDelivery>

/** What a Worker of the account exports for Hollware to deliver an agent's events over a binding. */
export interface HollwareAgentRpc {
  handle(event: HollwareEvent, grant: AgentGrant): Promise<void>
}

/**
 * The delivery a request carries, once its signature holds within the tolerance, or `null`: a
 * request that is not one, or a body of a kind this version does not know.
 */
export async function verifyAgentEvent(
  request: Request,
  secret: string,
  options: { readonly now?: number; readonly toleranceSeconds?: number } = {},
): Promise<AgentDelivery | null> {
  const body = await request.text()
  const signed = await verifyWebhook({
    secret,
    body,
    headers: request.headers,
    ...(options.now === undefined ? {} : { now: options.now }),
    ...(options.toleranceSeconds === undefined
      ? {}
      : { toleranceSeconds: options.toleranceSeconds }),
  })
  if (!signed) return null
  let json: unknown
  try {
    json = JSON.parse(body)
  } catch {
    return null
  }
  const parsed = agentDelivery.safeParse(json)
  return parsed.success ? parsed.data : null
}
