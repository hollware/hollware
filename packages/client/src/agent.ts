import type { AgentGrant, OperationName } from '@hollware/core'
import {
  createOpsClient,
  type OperationInput,
  type OperationOutput,
  type OpsClient,
} from './ops.ts'

export interface AgentClientOptions {
  /** How requests are sent; the global `fetch` when absent. */
  readonly fetch?: (request: Request) => Promise<Response>
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * The operations an agent's grant allows, over HTTP at `grant.ops`, as the agent's member:
 * `hollwareAgentClient(grant).call('comment_review', { id, body })`. A refusal throws with the
 * code, message and fix Hollware answered.
 */
export function hollwareAgentClient(
  grant: AgentGrant,
  options: AgentClientOptions = {},
): OpsClient {
  const send = options.fetch ?? ((request: Request) => fetch(request))
  return {
    call: async <Name extends OperationName>(name: Name, input: OperationInput<Name>) => {
      const response = await send(
        new Request(`${grant.ops}/${name}`, {
          method: 'POST',
          headers: {
            authorization: `Bearer ${grant.token}`,
            'content-type': 'application/json',
          },
          body: JSON.stringify(input),
        }),
      )
      const body: unknown = await response.json().catch(() => null)
      if (!response.ok) {
        const answer = isRecord(body) ? body : {}
        const text = (key: string) => (typeof answer[key] === 'string' ? answer[key] : '')
        throw new Error(
          `Hollware answered ${name} with ${response.status} ${text('code') || 'error'}: ${text('message')} ${text('fix')}`.trim(),
        )
      }
      return body as OperationOutput<Name>
    },
  }
}

/**
 * The same operations over a service binding to the `HollwareOps` entrypoint, for an agent that
 * runs in a Worker of the account: `hollwareAgentBindingClient(env.HOLLWARE_OPS, grant)`.
 */
export function hollwareAgentBindingClient(binding: unknown, grant: AgentGrant): OpsClient {
  return createOpsClient({ binding, token: grant.token })
}
