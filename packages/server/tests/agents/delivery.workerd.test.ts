import {
  AGENT_DEFAULT_SCOPES,
  newId,
  verifyAgentEvent,
  type AgentGrant,
  type ResolvedAgent,
  type ResolvedSite,
} from '@hollware/core'
import { env } from 'cloudflare:workers'
import { beforeAll, describe, expect, it, vi } from 'vitest'

import { checkPersonalToken } from '../../src/auth/token.ts'
import type { Principal } from '../../src/auth/types.ts'
import { connect } from '../../src/db/d1.ts'
import { failAgentRuns } from '../../src/events/agents.ts'
import { deliverEvent, type DeliveryDeps } from '../../src/events/deliver.ts'
import { agent, warmUpComark } from '../ops/support.ts'
import { createPost, newWorld, START, type World } from '../ops/world.ts'

vi.setConfig({ testTimeout: 60_000 })
beforeAll(warmUpComark, 120_000)

const SECRET = 'whsec_agent'
const PUBLIC = 'https://cms.example.com'
const HOOK = 'https://agents.example.com/in'

async function seedAgentMember(db: D1Database, site: string, name: string): Promise<string> {
  const id = newId('usr')
  await db.batch([
    db
      .prepare(
        `INSERT INTO users (id, name, role, kind, created_at, updated_at)
          VALUES (?1, ?2, 'reviewer', 'agent', ?3, ?3)`,
      )
      .bind(id, name, START),
    db
      .prepare(
        `INSERT INTO members (id, site_id, user_id, role, created_at, updated_at)
          VALUES (?1, ?2, ?3, 'author', ?4, ?4)`,
      )
      .bind(newId('mbr'), site, id, START),
  ])
  return id
}

function reviewer(member: string, delivery: ResolvedAgent['delivery']): ResolvedAgent {
  return {
    name: 'reviewer',
    member,
    events: ['review.requested'],
    delivery,
    scopes: [...AGENT_DEFAULT_SCOPES],
    required: true,
  }
}

function siteWith(world: World, agents: readonly ResolvedAgent[]): ResolvedSite {
  return { ...world.tenant.site, agents, review: { requireAgents: true } }
}

function network(status = 200) {
  const sent: Request[] = []
  return {
    sent,
    fetch: async (request: Request) => {
      sent.push(request.clone())
      return new Response(null, { status })
    },
  }
}

function deps(world: World, site: ResolvedSite, over: Partial<DeliveryDeps> = {}): DeliveryDeps {
  return {
    db: connect(world.db),
    site,
    clock: world.time.clock,
    fetch: network().fetch,
    secret: (name) => ({ AGENT_SECRET: SECRET })[name],
    publicUrl: `${PUBLIC}/`,
    ...over,
  }
}

async function askReview(world: World, site: ResolvedSite, slug: string) {
  const entry = await createPost(world, { slug, group: slug })
  await createPost(world, { slug: `${slug}-es`, locale: 'es', group: slug })
  const asked = await agent({ ...world.context(), site }).requestReview({
    id: entry.id,
    version: entry.version,
  })
  if (asked.review === undefined) throw new Error(JSON.stringify(asked))
  const { results } = await world.db
    .prepare(
      `SELECT id FROM outbox WHERE site_id = ?1 AND kind = 'review.requested'
        AND json_extract(payload, '$.review.id') = ?2`,
    )
    .bind(world.tenant.key, asked.review.id)
    .all<{ id: string }>()
  const [event] = results
  if (event === undefined) throw new Error('no review.requested event')
  return { review: asked.review.id, event: event.id }
}

async function principalOf(world: World, grant: AgentGrant, now = START): Promise<Principal> {
  const check = await checkPersonalToken(world.db, grant.token, {
    sites: new Set([world.tenant.key]),
    now: new Date(now),
  })
  if (!check.ok) throw new Error(`the grant was refused: ${check.reason}`)
  return check.principal
}

async function grantsOf(world: World) {
  const { results } = await world.db
    .prepare('SELECT agent, review_id, revoked_at FROM agent_grants WHERE site_id = ?1')
    .bind(world.tenant.key)
    .all<{ agent: string; review_id: string | null; revoked_at: string | null }>()
  return results
}

describe('an agent subscribed by webhook', () => {
  it('gets the event signed, with a grant that comments on that review and on no other', async () => {
    const world = await newWorld(env.DB, 'agent-webhook')
    const member = await seedAgentMember(world.db, world.tenant.key, 'reviewer')
    const site = siteWith(world, [
      reviewer(member, { kind: 'webhook', url: HOOK, secret: 'AGENT_SECRET' }),
    ])
    const { review, event } = await askReview(world, site, 'first-post')
    const other = await askReview(world, site, 'second-post')
    const net = network()

    const result = await deliverEvent(deps(world, site, { fetch: net.fetch }), event)
    const [request] = net.sent
    const delivery =
      request === undefined
        ? null
        : await verifyAgentEvent(request, SECRET, { now: Date.parse(START) / 1000 })

    expect(result).toEqual({ delivered: ['agent:reviewer'], failed: [] })
    expect(request?.url).toBe(HOOK)
    expect(delivery?.agent).toBe('reviewer')
    expect(delivery?.event).toMatchObject({ id: event, kind: 'review.requested' })
    expect({ ...delivery?.grant, token: delivery?.grant.token.slice(0, 7) }).toEqual({
      token: 'hw_agt_',
      expiresAt: '2026-10-13T11:00:00.000Z',
      scopes: ['content:read', 'review:read', 'review:comment'],
      review,
      mcp: 'https://cms.example.com/mcp',
      ops: 'https://cms.example.com/v1/ops',
    })
    if (delivery === null) throw new Error('no delivery')

    const principal = await principalOf(world, delivery.grant)
    const asAgent = agent({ ...world.context({ principal }), site })
    const commented = await asAgent.commentReview({ id: review, body: 'Reads well.' })
    const elsewhere = await asAgent.commentReview({ id: other.review, body: 'Hello.' })
    const read = await asAgent.getReview({ id: other.review })
    const listed = await asAgent.listReviews({})

    expect(principal).toMatchObject({
      kind: 'token',
      userId: member,
      scopes: ['content:read', 'review:read', 'review:comment'],
      agent: { name: 'reviewer', review },
    })
    expect(commented).toMatchObject({
      outcome: 'commented',
      comment: { author: member, authorName: 'reviewer', authorKind: 'agent' },
    })
    expect([elsewhere, read]).toEqual([{ outcome: 'not_found' }, { outcome: 'not_found' }])
    expect(listed.reviews.map((one) => [one.id, one.agents])).toEqual([
      [review, [{ name: 'reviewer', status: 'commented', required: true }]],
    ])
  })

  it('refuses the grant an hour later, and once its review is decided', async () => {
    const world = await newWorld(env.DB, 'agent-grant-dies')
    const member = await seedAgentMember(world.db, world.tenant.key, 'reviewer')
    const site = siteWith(world, [
      reviewer(member, { kind: 'webhook', url: HOOK, secret: 'AGENT_SECRET' }),
    ])
    const { review, event } = await askReview(world, site, 'dies')
    const net = network()
    await deliverEvent(deps(world, site, { fetch: net.fetch }), event)
    const [request] = net.sent
    const delivery =
      request === undefined
        ? null
        : await verifyAgentEvent(request, SECRET, {
            now: Date.parse(START) / 1000,
          })
    if (delivery === null) throw new Error('no delivery')
    const check = (now: string) =>
      checkPersonalToken(world.db, delivery.grant.token, {
        sites: new Set([world.tenant.key]),
        now: new Date(now),
      })

    const before = await check('2026-10-13T10:59:59.000Z')
    const expired = await check('2026-10-13T11:00:00.000Z')
    await agent({ ...world.context(), site }).rejectReview({ id: review, reason: 'Not now.' })
    const decided = await check('2026-10-13T10:30:00.000Z')

    expect([before.ok, expired, decided]).toEqual([
      true,
      { ok: false, reason: 'expired' },
      { ok: false, reason: 'revoked' },
    ])
  })

  it('takes no delivery of a member that is no agent, and mints no grant for it', async () => {
    const world = await newWorld(env.DB, 'agent-not-member')
    const site = siteWith(world, [
      reviewer(world.tenant.userId, { kind: 'webhook', url: HOOK, secret: 'AGENT_SECRET' }),
    ])
    const { event } = await askReview(world, site, 'person')
    const net = network()

    const result = await deliverEvent(deps(world, site, { fetch: net.fetch }), event)

    expect(result).toEqual({ delivered: [], failed: ['agent:reviewer'] })
    expect(net.sent).toEqual([])
    expect(await grantsOf(world)).toEqual([])
  })
})

describe('an agent subscribed by service binding', () => {
  it('is called with the event and a live grant; a failure revokes it and the retry mints another', async () => {
    const world = await newWorld(env.DB, 'agent-binding')
    const member = await seedAgentMember(world.db, world.tenant.key, 'reviewer')
    const site = siteWith(world, [reviewer(member, { kind: 'binding', binding: 'AGENTS' })])
    const { review, event } = await askReview(world, site, 'bound')
    const calls: { kind: string; grant: AgentGrant; live: boolean }[] = []
    let failing = true
    const binding = {
      handle: async (payload: { kind: string }, grant: AgentGrant) => {
        const check = await checkPersonalToken(world.db, grant.token, {
          sites: new Set([world.tenant.key]),
          now: new Date(START),
        })
        calls.push({ kind: payload.kind, grant, live: check.ok })
        if (failing) throw new Error('the agent is busy')
      },
    }
    const bound = deps(world, site, {
      binding: (name) => (name === 'AGENTS' ? binding : undefined),
    })

    const first = await deliverEvent(bound, event)
    failing = false
    const second = await deliverEvent(bound, event)
    const third = await deliverEvent(bound, event)

    expect([first, second, third]).toEqual([
      { delivered: [], failed: ['agent:reviewer'] },
      { delivered: ['agent:reviewer'], failed: [] },
      { delivered: [], failed: [] },
    ])
    expect(calls.map((call) => [call.kind, call.grant.review, call.live])).toEqual([
      ['review.requested', review, true],
      ['review.requested', review, true],
    ])
    expect((await grantsOf(world)).map((grant) => grant.revoked_at !== null)).toEqual([true, false])
  })

  it('marks the agent failed on the review when the event is given up', async () => {
    const world = await newWorld(env.DB, 'agent-abandoned')
    const member = await seedAgentMember(world.db, world.tenant.key, 'reviewer')
    const site = siteWith(world, [reviewer(member, { kind: 'binding', binding: 'MISSING' })])
    const { review, event } = await askReview(world, site, 'abandoned')

    await deliverEvent(deps(world, site), event)
    const queued = await agent({ ...world.context(), site }).getReview({ id: review })
    const failed = await failAgentRuns(connect(world.db), world.time.clock, world.tenant.key, event)
    const after = await agent({ ...world.context(), site }).getReview({ id: review })

    expect(queued.review?.agents).toEqual([{ name: 'reviewer', status: 'queued', required: true }])
    expect(failed).toEqual(['reviewer'])
    expect(after.review?.agents).toEqual([{ name: 'reviewer', status: 'failed', required: true }])
  })
})

describe('approving a review that waits for agents', () => {
  it('answers agents_pending until the required agent comments, unless an owner overrides', async () => {
    const world = await newWorld(env.DB, 'agent-required')
    const member = await seedAgentMember(world.db, world.tenant.key, 'reviewer')
    const site = siteWith(world, [reviewer(member, { kind: 'binding', binding: 'AGENTS' })])
    const first = await askReview(world, site, 'waits')
    const second = await askReview(world, site, 'overridden')
    const editor = agent({
      ...world.context({
        principal: {
          kind: 'token',
          userId: world.tenant.userId,
          tokenId: world.tenant.tokenId,
          site: world.tenant.key,
          scopes: ['content:read', 'content:write', 'content:publish'],
        },
      }),
      site,
    })
    const owner = agent({ ...world.context(), site })

    const waiting = await editor.approveReview({ id: first.review })
    const editorOverride = await editor.approveReview({ id: first.review, override: true })
    await world.store.markAgentRun(world.tenant.key, {
      reviewId: first.review,
      agent: 'reviewer',
      status: 'commented',
    })
    const approved = await editor.approveReview({ id: first.review })
    const overridden = await owner.approveReview({ id: second.review, override: true })

    expect(waiting).toMatchObject({
      outcome: 'agents_pending',
      agents: [{ name: 'reviewer', status: 'queued', required: true }],
    })
    expect(editorOverride.outcome).toBe('agents_pending')
    expect([approved.outcome, overridden.outcome]).toEqual(['published', 'published'])
  })

  it('does not wait when the site does not require agents', async () => {
    const world = await newWorld(env.DB, 'agent-not-required')
    const member = await seedAgentMember(world.db, world.tenant.key, 'reviewer')
    const site: ResolvedSite = {
      ...siteWith(world, [reviewer(member, { kind: 'binding', binding: 'AGENTS' })]),
      review: { requireAgents: false },
    }
    const { review } = await askReview(world, site, 'free')

    const approved = await agent({ ...world.context(), site }).approveReview({ id: review })

    expect(approved.outcome).toBe('published')
  })
})
