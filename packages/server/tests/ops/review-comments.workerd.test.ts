import { env } from 'cloudflare:workers'
import { beforeAll, describe, expect, it, vi } from 'vitest'

import type { Principal } from '../../src/auth/types.ts'
import { agent as agentFor, warmUpComark } from './support.ts'
import { createPost, newWorld, type World } from './world.ts'

// Fails when: request_review (src/ops/reviews.ts) publishes for a caller that holds
// content:publish, instead of asking for a review after the same checks as publish; or
// comment_review (src/ops/reviews.ts, src/db/reviews.ts) stops adding a comment to a
// pending review in the caller's name, with the name its client gave, or adds one to a review
// that was decided or that does not exist, or to a review of another site; or list_reviews stops
// answering each review with its comments, oldest first.

vi.setConfig({ testTimeout: 60_000 })
beforeAll(warmUpComark, 120_000)

const T1 = '2026-10-13T11:00:00.000Z'
const T2 = '2026-10-13T11:05:00.000Z'

function writer(world: World): Principal {
  return {
    kind: 'token',
    userId: world.tenant.userId,
    tokenId: world.tenant.tokenId,
    site: world.tenant.key,
    scopes: ['content:read', 'content:write'],
  }
}

/** A pending review of an English post, asked by a writer, and the writer's agent. */
async function pending(world: World) {
  const en = await createPost(world, { slug: 'edge-caching-guide', group: 'edge-caching-guide' })
  await createPost(world, { slug: 'guia-de-cache', locale: 'es', group: 'edge-caching-guide' })
  const agents = agentFor({
    ...world.context({ principal: writer(world) }),
    client: { name: 'hollware-agents', version: '0.6.0' },
  })
  const asked = await agents.publish({ id: en.id, version: en.version })
  if (asked.outcome !== 'pending_review' || asked.review === undefined) {
    throw new Error(JSON.stringify(asked))
  }
  return { en, agents, review: asked.review }
}

describe('comment_review', () => {
  it('adds a comment to a pending review, and list_reviews answers them oldest first', async () => {
    const world = await newWorld(env.DB, 'review-comments')
    const { agents, review } = await pending(world)

    world.time.set(T1)
    const first = await agents.commentReview({ id: review.id, body: 'Add an example.' })
    world.time.set(T2)
    await world.agent.commentReview({ id: review.id, body: 'Agreed.' })
    const listed = await world.agent.listReviews({})

    expect(first).toEqual({
      outcome: 'commented',
      comment: {
        id: expect.stringMatching(/^rvc_[0-9A-HJKMNP-TV-Z]{26}$/),
        author: world.tenant.userId,
        authorName: expect.any(String),
        client: 'hollware-agents',
        body: 'Add an example.',
        at: T1,
      },
    })
    expect(
      listed.reviews?.[0]?.comments.map(({ body, client, at }) => ({ body, client, at })),
    ).toEqual([
      { body: 'Add an example.', client: 'hollware-agents', at: T1 },
      { body: 'Agreed.', client: null, at: T2 },
    ])
  })

  it('takes no comment on a review that was decided, that does not exist, or of another site', async () => {
    const world = await newWorld(env.DB, 'review-comments-closed')
    const other = await newWorld(env.DB, 'review-comments-other')
    const { agents, review } = await pending(world)

    const foreign = await other.agent.commentReview({ id: review.id, body: 'Hello.' })
    await world.agent.requestChanges({ id: review.id, note: 'Cite a source.' })
    const decided = await agents.commentReview({ id: review.id, body: 'Too late.' })
    const missing = await agents.commentReview({
      id: 'rvw_01JAB3XQ8ZK4M6N2P5R7S9T0VX',
      body: 'Nobody here.',
    })
    const listed = await world.agent.listReviews({ status: 'changes_requested' })

    expect([foreign, decided, missing]).toEqual([
      { outcome: 'not_found' },
      { outcome: 'not_pending' },
      { outcome: 'not_found' },
    ])
    expect(listed.reviews?.[0]?.comments).toEqual([])
  })
})

describe('request_review', () => {
  it('asks for a review and publishes nothing, even for a caller who may publish', async () => {
    const world = await newWorld(env.DB, 'request-review')
    const en = await createPost(world, { slug: 'edge-caching-guide', group: 'edge-caching-guide' })
    await createPost(world, { slug: 'guia-de-cache', locale: 'es', group: 'edge-caching-guide' })

    // world.agent holds content:publish.
    const answer = await world.agent.requestReview({ id: en.id, version: en.version })
    const entry = await world.agent.getEntry({
      collection: 'blog',
      locale: 'en',
      slug: 'edge-caching-guide',
    })

    expect(answer).toMatchObject({ outcome: 'pending_review', review: { status: 'pending' } })
    expect(entry.entry?.status).toBe('draft')
  })

  it('stops where publish would, and asks for nothing', async () => {
    const world = await newWorld(env.DB, 'request-review-blocked')
    const created = await world.agent.createDraft({
      collection: 'blog',
      locale: 'en',
      slug: 'no-description',
      markdown: '---\ntitle: No description\n---\n\nText.\n',
    })

    const answer = await world.agent.requestReview({ id: created.entry?.id ?? '', version: 1 })
    const reviews = await world.agent.listReviews({})

    expect([answer.outcome, reviews.reviews]).toEqual(['blocked', []])
  })
})
