import { env } from 'cloudflare:workers'
import { newId } from '@hollware/core'
import { beforeAll, describe, expect, it, vi } from 'vitest'

import type { Principal } from '../../src/auth/types.ts'
import { countRows } from '../db/support.ts'
import { agent as agentFor, blogPost, warmUpComark } from './support.ts'
import { createPost, entryColumns, newWorld, publicationsOf, type World } from './world.ts'

// Fails when: the reviews of v0.3 stop working the way the specs say. publish.ts asks for a review
// instead of publishing for a principal without content:publish, after the same checks (blocked
// asks for nothing), answers the pending review again when asked twice, and refuses a group or a
// time for it; a new revision cancels the pending review (writes.ts, reviews.ts), and a
// publication approves it in its batch, in the name of whoever published; reviews.ts approves by
// publishing the revision asked for in the approver's name, answers not_pending for a review that
// is closed or whose revision is no longer the head, closes one with a note on request_changes,
// lists them newest first with their entry, and never shows a review of another site. D1 is real.

vi.setConfig({ testTimeout: 60_000 })
beforeAll(warmUpComark, 120_000)

const T1 = '2026-10-13T11:00:00.000Z'
const T2 = '2026-10-13T12:00:00.000Z'
const REVIEW_ID = expect.stringMatching(/^rvw_[0-9A-HJKMNP-TV-Z]{26}$/)

/** Someone who writes and may not publish, over a token of the tenant's user. */
function author(world: World): Principal {
  return {
    kind: 'token',
    userId: world.tenant.userId,
    tokenId: world.tenant.tokenId,
    site: world.tenant.key,
    scopes: ['content:read', 'content:write'],
  }
}

/** Another person, who may publish, signed in to the admin through OAuth. */
async function editor(world: World): Promise<Principal> {
  const userId = newId('usr')
  await world.db
    .prepare(
      "INSERT INTO users (id, name, role, created_at, updated_at) VALUES (?1, 'Edna', 'editor', ?2, ?2)",
    )
    .bind(userId, T1)
    .run()
  return {
    kind: 'oauth',
    userId,
    clientId: 'https://cms.example.com/admin/client.json',
    site: world.tenant.key,
    scopes: ['content:read', 'content:write', 'content:publish'],
  }
}

/** The English post of a translation pair, which the blog needs to publish, asked for review. */
async function asked(world: World) {
  const en = await createPost(world, { slug: 'edge-caching-guide', group: 'edge-caching-guide' })
  await createPost(world, { slug: 'guia-de-cache', locale: 'es', group: 'edge-caching-guide' })
  const writer = agentFor(world.context({ principal: author(world) }))
  world.time.set(T1)
  const answer = await writer.publish({ id: en.id, version: en.version })
  return { en, writer, answer }
}

function reviewsOf(world: World) {
  return countRows(world.db, 'reviews', world.tenant.key)
}

describe('publish without content:publish', () => {
  it('asks for a review of the head revision, after the checks, and publishes nothing', async () => {
    const world = await newWorld(env.DB, 'review-ask')
    const { en, answer } = await asked(world)

    expect(answer).toMatchObject({
      outcome: 'pending_review',
      entry: { id: en.id, status: 'draft', version: 1 },
      verdict: { ok: true, phase: 'publish' },
      review: {
        id: REVIEW_ID,
        entryId: en.id,
        revision: (await entryColumns(world.db, en.id))?.head_rev,
        status: 'pending',
        requestedBy: world.tenant.userId,
        requestedByName: 'Owner',
        requestedAt: T1,
        decidedBy: null,
        decidedAt: null,
        note: null,
      },
    })
    expect(await entryColumns(world.db, en.id)).toMatchObject({ status: 'draft', version: 1 })
    expect(await publicationsOf(world.db, en.id)).toEqual([])
  })

  it('answers the same pending review when asked again', async () => {
    const world = await newWorld(env.DB, 'review-again')
    const { en, writer, answer } = await asked(world)

    const again = await writer.publish({ id: en.id, version: en.version })

    expect(again.review?.id).toBe(answer.review?.id)
    expect(await reviewsOf(world)).toBe(1)
  })

  it('asks for nothing when the entry is blocked', async () => {
    const world = await newWorld(env.DB, 'review-blocked')
    const created = await world.agent.createDraft({
      collection: 'blog',
      locale: 'en',
      slug: 'edge-caching-guide',
      markdown: blogPost({}, '\n![](/images/edge.png)\n'),
    })
    const writer = agentFor(world.context({ principal: author(world) }))

    const answer = await writer.publish({ id: created.entry?.id ?? '', version: 1 })

    expect(answer.outcome).toBe('blocked')
    expect(await reviewsOf(world)).toBe(0)
  })

  it('refuses a group, and a time, with what to do instead', async () => {
    const world = await newWorld(env.DB, 'review-group')
    const en = await createPost(world, { slug: 'edge-caching-guide' })
    const writer = agentFor(world.context({ principal: author(world) }))

    await expect(
      writer.publish({ id: en.id, version: 1, publishAt: '2026-12-01T10:00:00Z' }),
    ).rejects.toMatchObject({ code: 'invalid_input' })
    await expect(
      writer.publish({ id: en.id, version: 1, group: [{ id: en.id, version: 1 }] }),
    ).rejects.toMatchObject({
      code: 'invalid_input',
      fix: 'Publish each entry on its own, without group and publishAt; a person who may publish approves it.',
    })
    expect(await reviewsOf(world)).toBe(0)
  })
})

describe('a pending review', () => {
  it('is cancelled by a new revision of the entry, and can no longer be approved', async () => {
    const world = await newWorld(env.DB, 'review-cancel')
    const { en, writer, answer } = await asked(world)
    const approver = agentFor(world.context({ principal: await editor(world) }))

    await writer.updateDraft({
      id: en.id,
      version: 1,
      markdown: blogPost({ title: 'Edge caching' }),
    })
    const approved = await approver.approveReview({ id: answer.review?.id ?? '' })

    expect(approved).toMatchObject({ outcome: 'not_pending', review: { status: 'cancelled' } })
    expect(await publicationsOf(world.db, en.id)).toEqual([])
  })

  it('is approved by publishing what it asked for, in the name of the person who approves', async () => {
    const world = await newWorld(env.DB, 'review-approve')
    const { en, answer } = await asked(world)
    const reviewer = await editor(world)
    world.time.set(T2)

    const approved = await agentFor(world.context({ principal: reviewer })).approveReview({
      id: answer.review?.id ?? '',
    })

    expect(approved).toMatchObject({
      outcome: 'published',
      entry: { id: en.id, status: 'published', version: 2 },
      review: { status: 'approved', decidedBy: reviewer.kind === 'oauth' ? reviewer.userId : '' },
    })
    const [publication] = await publicationsOf(world.db, en.id)
    expect(publication).toMatchObject({
      action: 'publish',
      revision_id: answer.review?.revision,
      actor_kind: 'oauth_client',
      actor_user_id: reviewer.kind === 'oauth' ? reviewer.userId : '',
      created_at: T2,
    })
  })

  it('is approved when someone who may publish publishes the entry anyway', async () => {
    const world = await newWorld(env.DB, 'review-direct')
    const { en, answer } = await asked(world)

    await world.agent.publish({ id: en.id, version: en.version })
    const listed = await world.agent.listReviews({ status: 'approved' })

    expect(listed.reviews.map((review) => [review.id, review.decidedBy])).toEqual([
      [answer.review?.id, world.tenant.userId],
    ])
  })

  it('is closed with a note on request_changes, and then is not pending', async () => {
    const world = await newWorld(env.DB, 'review-changes')
    const { en, answer } = await asked(world)
    const reviewer = agentFor(world.context({ principal: await editor(world) }))
    world.time.set(T2)

    const closed = await reviewer.requestChanges({
      id: answer.review?.id ?? '',
      note: 'Cite a source.',
    })
    const again = await reviewer.approveReview({ id: answer.review?.id ?? '' })

    expect(closed).toMatchObject({
      outcome: 'changes_requested',
      review: { status: 'changes_requested', note: 'Cite a source.', decidedAt: T2 },
    })
    expect(again.outcome).toBe('not_pending')
    expect(await entryColumns(world.db, en.id)).toMatchObject({ status: 'draft' })
  })
})

describe('list_reviews', () => {
  it('lists the pending reviews, newest first, each with its entry', async () => {
    const world = await newWorld(env.DB, 'review-list')
    const first = await asked(world)
    const other = await createPost(world, { slug: 'another-post', group: 'another-post' })
    await createPost(world, { slug: 'otro-post', locale: 'es', group: 'another-post' })
    world.time.set(T2)
    const second = await first.writer.publish({ id: other.id, version: other.version })

    const listed = await world.agent.listReviews()

    expect(listed.reviews.map((review) => [review.id, review.entry.slug])).toEqual([
      [second.review?.id, 'another-post'],
      [first.answer.review?.id, 'edge-caching-guide'],
    ])
  })

  it('never shows the reviews of another site, nor approves or closes them', async () => {
    const world = await newWorld(env.DB, 'review-mine')
    const { answer } = await asked(world)
    const stranger = await newWorld(env.DB, 'review-stranger')

    expect((await stranger.agent.listReviews()).reviews).toEqual([])
    expect(await stranger.agent.approveReview({ id: answer.review?.id ?? '' })).toEqual({
      outcome: 'not_found',
    })
    expect(
      await stranger.agent.requestChanges({ id: answer.review?.id ?? '', note: 'No.' }),
    ).toEqual({ outcome: 'not_found' })
  })
})
