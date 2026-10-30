import { env } from 'cloudflare:workers'
import { newId, parseHollwareEvent } from '@hollware/core'
import { beforeAll, describe, expect, it, vi } from 'vitest'

import type { Principal } from '../../src/auth/types.ts'
import { agent as agentFor, blogPost, warmUpComark } from './support.ts'
import {
  createPost,
  entryColumns,
  newWorld,
  publicationsOf,
  publishPost,
  type World,
} from './world.ts'

vi.setConfig({ testTimeout: 60_000 })
beforeAll(warmUpComark, 120_000)

const T1 = '2026-10-13T11:00:00.000Z'

function author(world: World): Principal {
  return {
    kind: 'token',
    userId: world.tenant.userId,
    tokenId: world.tenant.tokenId,
    site: world.tenant.key,
    scopes: ['content:read', 'content:write'],
  }
}

async function translated(world: World, slug: string) {
  const en = await createPost(world, { slug, group: slug })
  const es = await createPost(world, { slug: `${slug}-es`, locale: 'es', group: slug })
  return { en, es }
}

async function changeset(world: World) {
  const first = await translated(world, 'edge-caching-guide')
  const writer = agentFor(world.context({ principal: author(world) }))
  world.time.set(T1)
  const asked = await writer.requestReview({
    id: first.en.id,
    version: first.en.version,
    group: [{ id: first.es.id, version: first.es.version }],
  })
  if (asked.outcome !== 'pending_review' || asked.review === undefined) {
    throw new Error(JSON.stringify(asked))
  }
  return { ...first, writer, review: asked.review }
}

async function activeItems(world: World) {
  const { results } = await world.db
    .prepare(
      'SELECT entry_id, action, excluded, active FROM review_items WHERE site_id = ?1 ORDER BY rowid',
    )
    .bind(world.tenant.key)
    .all()
  return results
}

describe('a review of several entries', () => {
  it('holds every entry, and its approval publishes all of them in one step', async () => {
    const world = await newWorld(env.DB, 'changeset-approve')
    const { en, es, review } = await changeset(world)

    const approved = await world.agent.approveReview({ id: review.id })

    expect(approved).toMatchObject({
      outcome: 'published',
      review: { id: review.id, status: 'approved', entryId: en.id },
      entry: { id: en.id, status: 'published' },
    })
    expect(await entryColumns(world.db, en.id)).toMatchObject({ status: 'published' })
    expect(await entryColumns(world.db, es.id)).toMatchObject({ status: 'published' })
    expect(await activeItems(world)).toEqual([
      { entry_id: en.id, action: 'publish', excluded: 0, active: 0 },
      { entry_id: es.id, action: 'publish', excluded: 0, active: 0 },
    ])
    const listed = await world.agent.listReviews({ status: 'approved' })
    expect(listed.reviews.map((one) => [one.id, one.items])).toEqual([[review.id, 2]])
  })

  it('leaves an excluded entry as it is, and marks it so', async () => {
    const world = await newWorld(env.DB, 'changeset-exclude')
    const { en, es, review } = await changeset(world)
    const other = await createPost(world, { slug: 'guia-de-cache', locale: 'es', group: 'x' })

    await expect(
      world.agent.approveReview({ id: review.id, exclude: [other.id] }),
    ).rejects.toMatchObject({ code: 'invalid_input' })
    const approved = await world.agent.approveReview({
      id: review.id,
      exclude: [es.id],
      acknowledgeWarnings: [],
    })

    expect(approved.outcome).toBe('published')
    expect(await entryColumns(world.db, en.id)).toMatchObject({ status: 'published' })
    expect(await entryColumns(world.db, es.id)).toMatchObject({ status: 'draft' })
    expect(await publicationsOf(world.db, es.id)).toEqual([])
    expect(await activeItems(world)).toEqual([
      { entry_id: en.id, action: 'publish', excluded: 0, active: 0 },
      { entry_id: es.id, action: 'publish', excluded: 1, active: 0 },
    ])
    const read = await world.agent.getReview({ id: review.id })
    expect(read.items?.map((item) => [item.entry.id, item.excluded])).toEqual([
      [en.id, false],
      [es.id, true],
    ])
  })

  it('is cancelled whole by a new revision of any of its entries', async () => {
    const world = await newWorld(env.DB, 'changeset-cancel')
    const { en, es, writer, review } = await changeset(world)

    await writer.updateDraft({
      id: es.id,
      version: es.version,
      markdown: blogPost({ title: 'Guía', translationGroup: 'edge-caching-guide' }),
    })
    const approved = await world.agent.approveReview({ id: review.id })

    expect(approved).toMatchObject({ outcome: 'not_pending', review: { status: 'cancelled' } })
    expect(await activeItems(world)).toEqual([
      { entry_id: en.id, action: 'publish', excluded: 0, active: 0 },
      { entry_id: es.id, action: 'publish', excluded: 0, active: 0 },
    ])
    const again = await writer.requestReview({ id: en.id, version: en.version })
    expect(again).toMatchObject({ outcome: 'pending_review', review: { status: 'pending' } })
  })

  it('is asked by publish with a group, from someone who may not publish', async () => {
    const world = await newWorld(env.DB, 'changeset-publish')
    const { en, es } = await translated(world, 'edge-caching-guide')
    const writer = agentFor(world.context({ principal: author(world) }))

    const asked = await writer.publish({
      id: en.id,
      version: en.version,
      group: [{ id: es.id, version: es.version }],
    })

    expect(asked).toMatchObject({ outcome: 'pending_review', review: { entryId: en.id } })
    expect(await activeItems(world)).toEqual([
      { entry_id: en.id, action: 'publish', excluded: 0, active: 1 },
      { entry_id: es.id, action: 'publish', excluded: 0, active: 1 },
    ])
  })

  it('is cancelled whole when someone who may publish publishes one of its entries', async () => {
    const world = await newWorld(env.DB, 'changeset-direct')
    const { es, review } = await changeset(world)

    await world.agent.publish({ id: es.id, version: es.version })
    const read = await world.agent.listReviews({ status: 'cancelled' })

    expect(read.reviews.map((one) => one.id)).toEqual([review.id])
    expect(await activeItems(world)).toMatchObject([{ active: 0 }, { active: 0 }])
  })

  it('is refused when one of its entries is already in another pending review, naming it', async () => {
    const world = await newWorld(env.DB, 'changeset-held')
    const { es, writer, review } = await changeset(world)
    const other = await translated(world, 'another-post')

    const crossing = await writer.requestReview({
      id: other.en.id,
      version: other.en.version,
      group: [
        { id: other.es.id, version: other.es.version },
        { id: es.id, version: es.version },
      ],
    })

    expect(crossing).toMatchObject({
      outcome: 'conflict',
      review: { id: review.id, status: 'pending' },
      failedEntry: es.id,
    })
    expect(await activeItems(world)).toHaveLength(2)
  })

  it('takes a published entry off the site in the same step as it publishes the others', async () => {
    const world = await newWorld(env.DB, 'changeset-unpublish')
    const old = await translated(world, 'old-post')
    const live = await publishPost(world, old.en)
    const fresh = await translated(world, 'new-post')
    const writer = agentFor(world.context({ principal: author(world) }))

    const asked = await writer.requestReview({
      id: fresh.en.id,
      version: fresh.en.version,
      group: [{ id: fresh.es.id, version: fresh.es.version }],
      unpublish: [{ id: old.en.id, version: live.version }],
    })
    const read = await world.agent.getReview({ id: asked.review?.id ?? '' })
    const approved = await world.agent.approveReview({ id: asked.review?.id ?? '' })

    expect(read.items?.map((item) => [item.entry.id, item.action, item.proposed])).toEqual([
      [fresh.en.id, 'publish', expect.any(String)],
      [fresh.es.id, 'publish', expect.any(String)],
      [old.en.id, 'unpublish', null],
    ])
    expect(approved.outcome).toBe('published')
    expect(await entryColumns(world.db, old.en.id)).toMatchObject({
      status: 'draft',
      published_rev: null,
    })
    expect((await publicationsOf(world.db, old.en.id)).map((row) => row.action)).toEqual([
      'publish',
      'unpublish',
    ])
    expect(await entryColumns(world.db, fresh.en.id)).toMatchObject({ status: 'published' })
    const { results } = await world.db
      .prepare(
        "SELECT kind, payload FROM outbox WHERE site_id = ?1 AND kind IN ('entry.unpublished', 'review.requested') ORDER BY rowid",
      )
      .bind(world.tenant.key)
      .all<{ kind: string; payload: string }>()
    expect(results.map((row) => row.kind)).toEqual(['review.requested', 'entry.unpublished'])
    expect(parseHollwareEvent(results[0]?.payload ?? '')).toMatchObject({
      items: [
        { entryId: fresh.en.id, action: 'publish' },
        { entryId: fresh.es.id, action: 'publish' },
        { entryId: old.en.id, action: 'unpublish' },
      ],
    })
  })

  it('answers conflict, and publishes nothing, when an entry to unpublish moves while it is approved', async () => {
    const world = await newWorld(env.DB, 'changeset-moved')
    const old = await translated(world, 'old-post')
    const live = await publishPost(world, old.en)
    const fresh = await translated(world, 'new-post')
    const writer = agentFor(world.context({ principal: author(world) }))
    const asked = await writer.requestReview({
      id: fresh.en.id,
      version: fresh.en.version,
      group: [{ id: fresh.es.id, version: fresh.es.version }],
      unpublish: [{ id: old.en.id, version: live.version }],
    })

    const racing = agentFor(
      world.context(
        {},
        {
          ...world.store,
          approveReview: async (site, write) => {
            await world.agent.unpublish({ id: old.en.id })
            return world.store.approveReview(site, write)
          },
        },
      ),
    )
    const approved = await racing.approveReview({ id: asked.review?.id ?? '' })

    expect(approved).toMatchObject({ outcome: 'conflict', failedEntry: old.en.id })
    expect((await world.agent.listReviews()).reviews.map((one) => one.id)).toEqual([
      asked.review?.id,
    ])
    expect(await entryColumns(world.db, fresh.en.id)).toMatchObject({ status: 'draft' })
    expect(await entryColumns(world.db, fresh.es.id)).toMatchObject({ status: 'draft' })
  })
})

describe('get_review', () => {
  it('answers what is published, what is proposed and the unified diff between them', async () => {
    const world = await newWorld(env.DB, 'changeset-diff')
    const { en } = await translated(world, 'edge-caching-guide')
    const live = await publishPost(world, en)
    const writer = agentFor(world.context({ principal: author(world) }))
    const saved = await writer.updateDraft({
      id: en.id,
      version: live.version,
      markdown: blogPost(
        { title: 'Post edge-caching-guide', tags: '\n  - cloudflare' },
        '\n# Edge caching guide\n\nWhat an edge cache keeps, and for how long.\n',
      ),
    })
    const asked = await writer.requestReview({ id: en.id, version: saved.entry?.version ?? 0 })

    const read = await world.agent.getReview({ id: asked.review?.id ?? '' })
    const none = await world.agent.getReview({ id: newId('rvw') })

    expect(read.items?.map((item) => item.diff)).toEqual([
      '@@ -9,4 +9,4 @@\n \n # Edge caching guide\n \n-What an edge cache keeps.\n+What an edge cache keeps, and for how long.\n',
    ])
    expect(read.review).toMatchObject({ id: asked.review?.id, status: 'pending', comments: [] })
    expect(none).toEqual({ outcome: 'not_found' })
  })
})

describe('a comment on an entry of a review', () => {
  it('keeps the entry and the lines it is about, and refuses lines the proposal does not have', async () => {
    const world = await newWorld(env.DB, 'changeset-comment')
    const { en, es, writer, review } = await changeset(world)
    const stranger = await createPost(world, { slug: 'outside', group: 'outside' })

    const anchored = await writer.commentReview({
      id: review.id,
      body: 'Shorter title.',
      entryId: es.id,
      lines: { from: 2, to: 2 },
    })
    const read = await world.agent.getReview({ id: review.id })

    expect(anchored).toMatchObject({
      outcome: 'commented',
      comment: { entryId: es.id, lines: { from: 2, to: 2 } },
    })
    expect(read.review?.comments.map((comment) => [comment.entryId, comment.lines])).toEqual([
      [es.id, { from: 2, to: 2 }],
    ])
    await expect(
      writer.commentReview({
        id: review.id,
        body: 'Past the end.',
        entryId: en.id,
        lines: { from: 12, to: 13 },
      }),
    ).rejects.toMatchObject({ code: 'invalid_input' })
    await expect(
      writer.commentReview({ id: review.id, body: 'Not in it.', entryId: stranger.id }),
    ).rejects.toMatchObject({ code: 'invalid_input' })
  })
})

describe('a review asked before reviews held several entries', () => {
  it('is approved as it was: its one item, as the migration wrote it, publishes the entry', async () => {
    const world = await newWorld(env.DB, 'changeset-migrated')
    const { en } = await translated(world, 'edge-caching-guide')
    const head = (await entryColumns(world.db, en.id))?.head_rev ?? ''
    const id = newId('rvw')
    await world.db.batch([
      world.db
        .prepare(
          `INSERT INTO reviews (id, site_id, entry_id, revision_id, status, acknowledged, requested_by, created_at, updated_at)
            VALUES (?1, ?2, ?3, ?4, 'pending', '[]', ?5, ?6, ?6)`,
        )
        .bind(id, world.tenant.key, en.id, head, world.tenant.userId, T1),
      world.db
        .prepare(
          `INSERT INTO review_items (id, site_id, review_id, entry_id, revision_id, base_revision_id, action, excluded, active, created_at, updated_at)
            VALUES ('rvi_' || substr(?1, 5), ?2, ?1, ?3, ?4, NULL, 'publish', 0, 1, ?5, ?5)`,
        )
        .bind(id, world.tenant.key, en.id, head, T1),
    ])

    const approved = await world.agent.approveReview({ id })

    expect(approved).toMatchObject({
      outcome: 'published',
      review: { id, status: 'approved' },
      entry: { id: en.id, status: 'published' },
    })
    expect(await activeItems(world)).toEqual([
      { entry_id: en.id, action: 'publish', excluded: 0, active: 0 },
    ])
  })
})
