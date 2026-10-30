import { parseHollwareEvent } from '@hollware/core'
import { env } from 'cloudflare:workers'
import { beforeAll, describe, expect, it, vi } from 'vitest'

import type { Principal } from '../../src/auth/types.ts'
import { connect } from '../../src/db/d1.ts'
import { sweepOutbox } from '../../src/events/run.ts'
import { agent as agentFor, blogPost, warmUpComark } from './support.ts'
import { createPost, newWorld, type World } from './world.ts'

vi.setConfig({ testTimeout: 60_000 })
beforeAll(warmUpComark, 120_000)

const T1 = '2026-10-13T11:00:00.000Z'
const T2 = '2026-10-13T12:00:00.000Z'

function author(world: World): Principal {
  return {
    kind: 'token',
    userId: world.tenant.userId,
    tokenId: world.tenant.tokenId,
    site: world.tenant.key,
    scopes: ['content:read', 'content:write'],
  }
}

async function asked(world: World) {
  const en = await createPost(world, { slug: 'edge-caching-guide', group: 'edge-caching-guide' })
  await createPost(world, { slug: 'guia-de-cache', locale: 'es', group: 'edge-caching-guide' })
  const writer = agentFor(world.context({ principal: author(world) }))
  world.time.set(T1)
  const answer = await writer.publish({ id: en.id, version: en.version })
  return { en, writer, reviewId: answer.review?.id ?? '' }
}

async function reviewEventsOf(world: World) {
  const { results } = await world.db
    .prepare(
      "SELECT id, entry_id, payload, sent_at FROM outbox WHERE site_id = ?1 AND kind LIKE 'review.%' ORDER BY rowid",
    )
    .bind(world.tenant.key)
    .all<{ id: string; entry_id: string; payload: string; sent_at: string | null }>()
  return results
}

describe('the events of a review', () => {
  it('asking for one writes review.requested, which parseHollwareEvent reads', async () => {
    const world = await newWorld(env.DB, 'review-event-asked')
    const { en, reviewId } = await asked(world)

    const rows = await reviewEventsOf(world)

    expect(rows).toEqual([
      {
        id: expect.stringMatching(/^evt_[0-9A-F]{26}$/),
        entry_id: en.id,
        payload: expect.any(String),
        sent_at: null,
      },
    ])
    expect(parseHollwareEvent(rows[0]?.payload ?? '')).toEqual({
      id: rows[0]?.id,
      kind: 'review.requested',
      site: world.tenant.key,
      at: T1,
      cacheTags: [],
      review: { id: reviewId, status: 'pending', requestedBy: 'Owner', note: null },
      entry: {
        id: en.id,
        collection: 'blog',
        locale: 'en',
        slug: 'edge-caching-guide',
        translationGroup: 'edge-caching-guide',
      },
      items: [{ entryId: en.id, action: 'publish' }],
      adminPath: `/admin/reviews?review=${reviewId}`,
    })
  })

  it.each([
    ['approved', null, 'review-approved'],
    ['changes_requested', 'Cite a source.', 'review-changes'],
    ['rejected', 'Not for this site.', 'review-rejected'],
    ['cancelled', null, 'review-cancelled'],
  ] as const)('deciding it writes review.decided, %s', async (status, note, label) => {
    const world = await newWorld(env.DB, label)
    const { en, writer, reviewId } = await asked(world)
    world.time.set(T2)

    if (status === 'approved') await world.agent.approveReview({ id: reviewId })
    if (status === 'changes_requested') {
      await world.agent.requestChanges({ id: reviewId, note: 'Cite a source.' })
    }
    if (status === 'rejected') {
      await world.agent.rejectReview({ id: reviewId, reason: 'Not for this site.' })
    }
    if (status === 'cancelled') {
      await writer.updateDraft({
        id: en.id,
        version: en.version,
        markdown: blogPost({ title: 'Edge caching' }),
      })
    }

    const events = (await reviewEventsOf(world)).map((row) => parseHollwareEvent(row.payload))
    expect(events.map((event) => event?.kind)).toEqual(['review.requested', 'review.decided'])
    expect(events[1]).toMatchObject({
      at: T2,
      review: { id: reviewId, status, requestedBy: 'Owner', note },
      entry: { id: en.id, slug: 'edge-caching-guide' },
      items: [{ entryId: en.id, action: 'publish' }],
    })
  })

  it('reaches the webhooks of the site at the next sweep, and not IndexNow', async () => {
    const world = await newWorld(env.DB, 'review-event-swept')
    await asked(world)
    world.time.set(T2)
    const sent: { url: string; body: string }[] = []

    await sweepOutbox({
      queue: undefined,
      deps: {
        db: connect(world.db),
        site: {
          ...world.tenant.site,
          url: 'https://example.com',
          events: {
            webhooks: [{ name: 'hook', url: 'https://hooks.example.com/in', secret: 'HOOK' }],
            indexNow: { key: 'a1b2c3d4e5f60718' },
          },
        },
        clock: world.time.clock,
        fetch: async (request) => {
          sent.push({ url: request.url, body: await request.text() })
          return new Response(null, { status: 200 })
        },
        secret: (name) => ({ HOOK: 'whsec_reviews' })[name],
      },
    })

    expect(sent.map(({ url, body }) => [url, parseHollwareEvent(body)?.kind])).toEqual([
      ['https://hooks.example.com/in', 'review.requested'],
    ])
    expect((await reviewEventsOf(world)).map((row) => row.sent_at)).toEqual([T2])
  })
})
