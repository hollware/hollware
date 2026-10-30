import {
  AGENT_GRANT_TTL_MINUTES,
  EVENT_ID_HEADER,
  generateAgentGrant,
  hashPersonalToken,
  newId,
  parseHollwareEvent,
  SIGNATURE_HEADER,
  signWebhook,
  TIMESTAMP_HEADER,
  type AgentGrant,
  type ResolvedAgent,
} from '@hollware/core'
import { and, eq, isNull, like } from 'drizzle-orm'
import type { Db } from '../db/d1.ts'
import { findEvent } from '../db/events.ts'
import { markAgentRun } from '../db/reviews.ts'
import { agentGrants, deliveries, members, users } from '../db/schema.ts'
import type { EventPayload } from '../ops/event.ts'
import type { Clock } from '../ports.ts'
import type { DeliveryDeps } from './deliver.ts'

const MINUTE_MS = 60_000

function withoutTrailingSlashes(text: string): string {
  let end = text.length
  while (end > 0 && text[end - 1] === '/') end--
  return text.slice(0, end)
}

async function isAgentMember(db: Db, site: string, userId: string): Promise<boolean> {
  const [row] = await db
    .select({ id: users.id })
    .from(members)
    .innerJoin(users, eq(users.id, members.userId))
    .where(and(eq(members.siteId, site), eq(members.userId, userId), eq(users.kind, 'agent')))
    .limit(1)
  return row !== undefined
}

async function mintGrant(
  deps: DeliveryDeps,
  agent: ResolvedAgent,
  review: string | null,
  publicUrl: string,
): Promise<{ readonly id: string; readonly grant: AgentGrant }> {
  const now = deps.clock.now()
  const token = generateAgentGrant()
  const id = newId('agt')
  const expiresAt = new Date(now.getTime() + AGENT_GRANT_TTL_MINUTES * MINUTE_MS).toISOString()
  await deps.db.insert(agentGrants).values({
    id,
    siteId: deps.site.key,
    userId: agent.member,
    agent: agent.name,
    reviewId: review,
    hash: await hashPersonalToken(token),
    scopes: JSON.stringify(agent.scopes),
    expiresAt,
    revokedAt: null,
    createdAt: now.toISOString(),
    updatedAt: now.toISOString(),
  })
  const base = withoutTrailingSlashes(publicUrl)
  return {
    id,
    grant: {
      token,
      expiresAt,
      scopes: [...agent.scopes],
      review,
      mcp: `${base}/mcp`,
      ops: `${base}/v1/ops`,
    },
  }
}

async function revokeGrant(deps: DeliveryDeps, id: string): Promise<void> {
  const now = deps.clock.now().toISOString()
  await deps.db
    .update(agentGrants)
    .set({ revokedAt: now, updatedAt: now })
    .where(and(eq(agentGrants.siteId, deps.site.key), eq(agentGrants.id, id)))
}

async function send(
  deps: DeliveryDeps,
  agent: ResolvedAgent,
  payload: EventPayload,
  grant: AgentGrant,
): Promise<void> {
  const { delivery } = agent
  if (delivery.kind === 'binding') {
    const target = deps.binding?.(delivery.binding)
    const handle =
      typeof target === 'object' && target !== null ? Reflect.get(target, 'handle') : undefined
    if (typeof handle !== 'function') {
      throw new Error(`the binding ${delivery.binding} of the agent ${agent.name} has no handle`)
    }
    await Reflect.apply(handle, target, [payload, grant])
    return
  }
  const secret =
    delivery.secret === null
      ? await deps.sealed?.(`agent:${agent.name}`)
      : deps.secret(delivery.secret)
  if (secret === undefined) {
    throw new Error(
      delivery.secret === null
        ? `the agent ${agent.name} has no secret of Hollware's yet: make it with make_webhook_secret`
        : `the secret ${delivery.secret} is not set`,
    )
  }
  const body = JSON.stringify({ agent: agent.name, event: payload, grant })
  const timestamp = Math.floor(deps.clock.now().getTime() / 1000)
  const response = await deps.fetch(
    new Request(delivery.url, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        [EVENT_ID_HEADER]: payload.id,
        [TIMESTAMP_HEADER]: String(timestamp),
        [SIGNATURE_HEADER]: await signWebhook(secret, timestamp, body),
      },
      body,
    }),
  )
  if (!response.ok) throw new Error(`the agent ${agent.name} answered ${response.status}`)
}

export async function deliverToAgent(
  deps: DeliveryDeps,
  agent: ResolvedAgent,
  payload: EventPayload,
): Promise<void> {
  if (deps.publicUrl === undefined || deps.publicUrl === '') {
    throw new Error('HOLLWARE_PUBLIC_URL is not set, so no agent can be told where to act')
  }
  if (!(await isAgentMember(deps.db, deps.site.key, agent.member))) {
    throw new Error(
      `the agent ${agent.name} names ${agent.member}, which is no agent member of the site`,
    )
  }
  const review = payload.kind === 'review.requested' ? payload.review.id : null
  if (review !== null) {
    await markAgentRun(deps.db, deps.clock, deps.site.key, {
      reviewId: review,
      agent: agent.name,
      status: 'queued',
    })
  }
  const minted = await mintGrant(deps, agent, review, deps.publicUrl)
  try {
    await send(deps, agent, payload, minted.grant)
  } catch (error) {
    await revokeGrant(deps, minted.id)
    throw error
  }
}

export async function failAgentRuns(
  db: Db,
  clock: Clock,
  site: string,
  eventId: string,
): Promise<readonly string[]> {
  const event = await findEvent(db, site, eventId)
  const payload = event === null ? null : parseHollwareEvent(event.payload)
  if (payload === null || payload.kind !== 'review.requested') return []
  const undelivered = await db
    .select({ subscriber: deliveries.subscriber })
    .from(deliveries)
    .where(
      and(
        eq(deliveries.siteId, site),
        eq(deliveries.eventId, eventId),
        like(deliveries.subscriber, 'agent:%'),
        isNull(deliveries.deliveredAt),
      ),
    )
  const agents = undelivered.map((row) => row.subscriber.slice('agent:'.length))
  for (const agent of agents) {
    await markAgentRun(db, clock, site, { reviewId: payload.review.id, agent, status: 'failed' })
  }
  return agents
}
