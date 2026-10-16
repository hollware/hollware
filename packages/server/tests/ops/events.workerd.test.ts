import { verifyWebhook, type ResolvedSite } from '@hollware/core'
import { env } from 'cloudflare:workers'
import { beforeAll, describe, expect, it, vi } from 'vitest'

import { connect } from '../../src/db/d1.ts'
import { deliverEvent, INDEXNOW_ENDPOINT, type DeliveryDeps } from '../../src/events/deliver.ts'
import { consumeEvents, sweepOutbox, type EventMessage } from '../../src/events/run.ts'
import { agent, blogFrontmatter, warmUpComark } from './support.ts'
import { newWorld, type World } from './world.ts'

// Fails when: a publish or an unpublish stops writing its event to the outbox in its own batch
// (ADR-025): exactly one row for a write that happened, none for one that was refused; the event
// stops naming the entry, its path and its URL; deliverEvent stops signing a webhook so that
// verifyWebhook accepts it, stops telling IndexNow the URL, or sends an event twice to a subscriber
// that had it; consumeEvents stops asking for a retry while a subscriber failed; or the sweep stops
// putting unsent events on the Queue, or, without one, delivering them and marking them sent.

vi.setConfig({ testTimeout: 60_000 })
beforeAll(warmUpComark, 120_000)

const SECRET = 'whsec_events'

function withEvents(site: ResolvedSite): ResolvedSite {
  return {
    ...site,
    url: 'https://example.com',
    events: {
      webhooks: [{ name: 'hook', url: 'https://hooks.example.com/in', secret: 'HOOK_SECRET' }],
      indexNow: { key: 'INDEXNOW_KEY' },
    },
  }
}

/** A fake network: what was sent, and an answer per URL (200 unless told otherwise). */
function network(statuses: Record<string, number> = {}) {
  const sent: { url: string; body: string; headers: Headers }[] = []
  return {
    sent,
    fetch: async (request: Request) => {
      sent.push({ url: request.url, body: await request.text(), headers: request.headers })
      return new Response(null, { status: statuses[request.url] ?? 200 })
    },
  }
}

function deps(world: World, fetch: DeliveryDeps['fetch']): DeliveryDeps {
  return {
    db: connect(world.db),
    site: withEvents(world.tenant.site),
    clock: world.time.clock,
    fetch,
    secret: (name) => ({ HOOK_SECRET: SECRET, INDEXNOW_KEY: 'key123' })[name],
  }
}

async function outboxOf(world: World) {
  const { results } = await world.db
    .prepare('SELECT id, kind, payload, sent_at FROM outbox WHERE site_id = ?1 ORDER BY rowid')
    .bind(world.tenant.key)
    .all<{ id: string; kind: string; payload: string; sent_at: string | null }>()
  return results
}

/** A published pair (en, es) in one group, on the site with a url and subscribers. */
async function published(world: World) {
  const writer = agent({ ...world.context(), site: withEvents(world.tenant.site) })
  const md = (slug: string) =>
    `${blogFrontmatter({ translationGroup: 'pair' })}\nText about ${slug}.\n`
  const en = await world.agent.createDraft({
    collection: 'blog',
    locale: 'en',
    slug: 'pair-en',
    markdown: md('en'),
  })
  await world.agent.createDraft({
    collection: 'blog',
    locale: 'es',
    slug: 'pair-es',
    markdown: md('es'),
  })
  if (en.entry === undefined) throw new Error(JSON.stringify(en))
  const answer = await writer.publish({ id: en.entry.id, version: 1 })
  expect(answer.outcome).toBe('published')
  return en.entry.id
}

describe('the outbox', () => {
  it('gets one event per write that happened, and none for a write that was refused', async () => {
    const world = await newWorld(env.DB, 'outbox')
    const id = await published(world)

    const stale = await world.agent.publish({ id, version: 1 })
    await world.agent.unpublish({ id })
    await world.agent.unpublish({ id })

    expect(stale.outcome).toBe('conflict')
    const rows = await outboxOf(world)
    expect(rows.map((row) => row.kind)).toEqual(['entry.published', 'entry.unpublished'])
    expect(JSON.parse(rows[0]?.payload ?? '{}')).toMatchObject({
      kind: 'entry.published',
      site: world.tenant.key,
      entry: { id, collection: 'blog', locale: 'en', slug: 'pair-en', translationGroup: 'pair' },
      path: '/en/blog/pair-en/',
      url: 'https://example.com/en/blog/pair-en/',
      // What a site purges: the entry, the list of its collection in its locale, its group.
      cacheTags: [`entry:${id}`, 'list:blog:en', 'group:blog:pair'],
    })
  })
})

describe('the outbox, at the store', () => {
  it('gets no event from a publish that a racing writer made stale', async () => {
    const world = await newWorld(env.DB, 'outbox-race')
    const id = await published(world)

    const answer = await world.store.publish(world.tenant.key, {
      entryId: id,
      expectedVersion: 1,
      verdict: { ok: true, phase: 'publish', errors: [], warnings: [], contractsHash: 'h' },
      acknowledged: [],
      actor: {
        kind: 'token',
        userId: world.tenant.userId,
        tokenId: world.tenant.tokenId,
        meta: null,
      },
      sortKey: '2026-10-13T10:00:00.000Z',
      event: { id: 'evt_01JAB3XQ8ZK4M6N2P5R7S9T0VW', payload: '{"kind":"entry.published"}' },
    })

    expect(answer.outcome).toBe('conflict')
    expect((await outboxOf(world)).map((row) => row.id)).not.toContain(
      'evt_01JAB3XQ8ZK4M6N2P5R7S9T0VW',
    )
  })
})

describe('deliveries', () => {
  it('sign the webhook so that verifyWebhook accepts it, and tell IndexNow the URL', async () => {
    const world = await newWorld(env.DB, 'deliver')
    await published(world)
    const [event] = await outboxOf(world)
    const net = network()

    const result = await deliverEvent(deps(world, net.fetch), event?.id ?? '')

    expect(result).toEqual({ delivered: ['webhook:hook', 'indexnow'], failed: [] })
    const [hook, indexNow] = net.sent
    expect(hook?.url).toBe('https://hooks.example.com/in')
    expect(
      await verifyWebhook({
        secret: SECRET,
        body: hook?.body ?? '',
        headers: hook?.headers ?? new Headers(),
        now: Math.floor(Date.parse('2026-10-13T10:00:00.000Z') / 1000),
      }),
    ).toBe(true)
    expect([indexNow?.url, JSON.parse(indexNow?.body ?? '{}')]).toEqual([
      INDEXNOW_ENDPOINT,
      { host: 'example.com', key: 'key123', urlList: ['https://example.com/en/blog/pair-en/'] },
    ])
  })

  it("sign with Hollware's own secret a webhook that names none, and fail one that has none yet", async () => {
    const world = await newWorld(env.DB, 'own-secret')
    await published(world)
    const [event] = await outboxOf(world)
    const own = (secrets: Record<string, string>): DeliveryDeps => ({
      ...deps(world, net.fetch),
      site: {
        ...withEvents(world.tenant.site),
        events: {
          webhooks: [{ name: 'hook', url: 'https://hooks.example.com/in', secret: null }],
          indexNow: null,
        },
      },
      ownSecret: async (webhook) => secrets[webhook],
    })
    const net = network()

    const without = await deliverEvent(own({}), event?.id ?? '')
    const signed = await deliverEvent(own({ hook: 'whsec_own' }), event?.id ?? '')

    expect([without, signed]).toEqual([
      { delivered: [], failed: ['webhook:hook'] },
      { delivered: ['webhook:hook'], failed: [] },
    ])
    const [hook] = net.sent
    expect(
      await verifyWebhook({
        secret: 'whsec_own',
        body: hook?.body ?? '',
        headers: hook?.headers ?? new Headers(),
        now: Math.floor(Date.parse('2026-10-13T10:00:00.000Z') / 1000),
      }),
    ).toBe(true)
  })

  it('retry only the subscriber that failed, and never send an event twice', async () => {
    const world = await newWorld(env.DB, 'retry')
    await published(world)
    const [event] = await outboxOf(world)
    const failing = network({ 'https://hooks.example.com/in': 503 })
    const healthy = network()

    const first = await deliverEvent(deps(world, failing.fetch), event?.id ?? '')
    const second = await deliverEvent(deps(world, healthy.fetch), event?.id ?? '')
    const third = await deliverEvent(deps(world, healthy.fetch), event?.id ?? '')

    expect([first, second, third]).toEqual([
      { delivered: ['indexnow'], failed: ['webhook:hook'] },
      { delivered: ['webhook:hook'], failed: [] },
      { delivered: [], failed: [] },
    ])
    expect(healthy.sent.map((sent) => sent.url)).toEqual(['https://hooks.example.com/in'])
  })

  it('are retried by the Queue consumer while a subscriber fails', async () => {
    const world = await newWorld(env.DB, 'consume')
    await published(world)
    const [event] = await outboxOf(world)
    const verdicts: string[] = []
    const message = (body: EventMessage) => ({
      body,
      ack: () => verdicts.push(`ack ${body.id}`),
      retry: () => verdicts.push(`retry ${body.id}`),
    })
    const id = event?.id ?? ''

    // The deployment serves the site of the world, and no other.
    const served = (fetch: DeliveryDeps['fetch']) => (site: string) =>
      site === world.tenant.key ? deps(world, fetch) : undefined

    await consumeEvents(
      [message({ site: world.tenant.key, id })],
      served(network({ [INDEXNOW_ENDPOINT]: 500 }).fetch),
    )
    await consumeEvents([message({ site: world.tenant.key, id })], served(network().fetch))
    await consumeEvents([message({ site: 'another-site', id })], served(network().fetch))

    expect(verdicts).toEqual([`retry ${id}`, `ack ${id}`, `ack ${id}`])
  })
})

describe('the sweep of the cron trigger', () => {
  it('puts unsent events on the Queue, or delivers them without one, and marks them sent', async () => {
    const queued = await newWorld(env.DB, 'sweep-queue')
    await published(queued)
    const sentBatches: unknown[] = []
    await sweepOutbox({
      queue: { sendBatch: async (messages) => void sentBatches.push([...messages]) },
      deps: deps(queued, network().fetch),
    })

    const direct = await newWorld(env.DB, 'sweep-direct')
    await published(direct)
    const net = network()
    await sweepOutbox({ queue: undefined, deps: deps(direct, net.fetch) })

    const [queuedEvent] = await outboxOf(queued)
    expect(sentBatches).toEqual([[{ body: { site: queued.tenant.key, id: queuedEvent?.id } }]])
    expect(queuedEvent?.sent_at).not.toBe(null)
    expect(net.sent.map((sent) => sent.url)).toEqual([
      'https://hooks.example.com/in',
      INDEXNOW_ENDPOINT,
    ])
    expect((await outboxOf(direct))[0]?.sent_at).not.toBe(null)
  })
})
