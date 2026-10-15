import { env } from 'cloudflare:workers'
import { beforeAll, describe, expect, it, vi } from 'vitest'

import { connect } from '../../src/db/d1.ts'
import { deliverEvent } from '../../src/events/deliver.ts'
import { healVectors, syncEntryVectors } from '../../src/semantic/index-entry.ts'
import type { Semantic } from '../../src/ports.ts'
import { blogPost, warmUpComark } from '../ops/support.ts'
import { newWorld, type World } from '../ops/world.ts'
import { fakeSemantic } from './fakes.ts'

// Fails when: the vectors of an entry (src/semantic/index-entry.ts) stop following what it has
// published: a published entry does not get one vector per piece (`<entry id>:<piece>`, with its
// site, collection, locale and piece), a second sync of the same revision, model and chunker
// embeds again, a new revision with fewer sections leaves the vectors of the sections it lost, an
// entry with nothing published keeps its vectors or its row, or another model is taken as
// current; or the cron's sweep (healVectors) stops finding the entries whose vectors are missing,
// stale or of nothing published, keeping to its limit, or leaving an entry that failed for later;
// or the `vectors` subscriber (src/events/deliver.ts) stops running on the events of a
// site whose Worker has semantic search, or runs on one whose Worker has none.

vi.setConfig({ testTimeout: 60_000 })
beforeAll(warmUpComark, 120_000)

const TWO_SECTIONS =
  '\nThe intro of the post.\n\n## Caching\n\nWhat a cache keeps.\n\n## Purging\n\nWhen it lets go.\n'
const ONE_SECTION = '\nThe intro of the post.\n\n## Caching\n\nWhat a cache keeps.\n'

async function publishedPost(world: World, body = TWO_SECTIONS, slug = 'vectors') {
  const created = await world.agent.createDraft({
    collection: 'blog',
    locale: 'en',
    slug,
    markdown: blogPost({ translationGroup: slug }, body),
  })
  if (created.entry === undefined) throw new Error(JSON.stringify(created))
  // The blog publishes a post only with its translation.
  await world.agent.createDraft({
    collection: 'blog',
    locale: 'es',
    slug: `${slug}-es`,
    markdown: blogPost({ translationGroup: slug }, body),
  })
  const published = await world.agent.publish({ id: created.entry.id, version: 1 })
  if (published.outcome !== 'published') throw new Error(JSON.stringify(published))
  return created.entry.id
}

function sync(world: World, semantic: Semantic, entryId: string) {
  return syncEntryVectors(connect(world.db), semantic, {
    site: world.tenant.key,
    entryId,
    now: '2026-10-15T12:00:00.000Z',
  })
}

async function rowOf(world: World, entryId: string) {
  return world.db
    .prepare(
      'SELECT revision_id, model, chunker_version, pieces FROM entry_embeddings WHERE entry_id = ?1',
    )
    .bind(entryId)
    .first<{ revision_id: string; model: string; chunker_version: string; pieces: number }>()
}

async function publishedRevision(world: World, entryId: string) {
  const row = await world.db
    .prepare('SELECT published_rev FROM entries WHERE id = ?1')
    .bind(entryId)
    .first<{ published_rev: string | null }>()
  return row?.published_rev ?? null
}

describe('the vectors of an entry', () => {
  it('are one per piece of what it published, and a second sync embeds nothing', async () => {
    const world = await newWorld(env.DB, 'vectors-index')
    const id = await publishedPost(world)
    const { semantic, embedder, index } = fakeSemantic()

    const first = await sync(world, semantic, id)
    const second = await sync(world, semantic, id)

    expect([first, second]).toEqual(['indexed', 'current'])
    expect(embedder.calls).toEqual([
      [
        'Edge caching guide How to cache at the edge. The intro of the post.',
        'Caching What a cache keeps.',
        'Purging When it lets go.',
      ],
    ])
    expect([...index.vectors.keys()]).toEqual([`${id}:0`, `${id}:1`, `${id}:2`])
    expect(index.vectors.get(`${id}:2`)?.metadata).toEqual({
      site: world.tenant.key,
      entry: id,
      collection: 'blog',
      locale: 'en',
      piece: 2,
      excerpt: 'Purging When it lets go.',
    })
    expect(await rowOf(world, id)).toEqual({
      revision_id: await publishedRevision(world, id),
      model: 'fake-model',
      chunker_version: '1',
      pieces: 3,
    })
  })

  it('lose the pieces a new revision no longer has', async () => {
    const world = await newWorld(env.DB, 'vectors-shrink')
    const id = await publishedPost(world)
    const { semantic, index } = fakeSemantic()
    await sync(world, semantic, id)

    await world.agent.updateDraft({
      id,
      version: 2,
      markdown: blogPost({ translationGroup: 'vectors' }, ONE_SECTION),
    })
    expect((await world.agent.publish({ id, version: 3 })).outcome).toBe('published')
    const answer = await sync(world, semantic, id)

    expect(answer).toBe('indexed')
    expect([...index.vectors.keys()]).toEqual([`${id}:0`, `${id}:1`])
    expect(await rowOf(world, id)).toMatchObject({
      revision_id: await publishedRevision(world, id),
      pieces: 2,
    })
  })

  it('go, with their row, when the entry has nothing published', async () => {
    const world = await newWorld(env.DB, 'vectors-unpublish')
    const id = await publishedPost(world)
    const { semantic, index } = fakeSemantic()
    await sync(world, semantic, id)

    await world.agent.unpublish({ id })
    const answers = [await sync(world, semantic, id), await sync(world, semantic, id)]

    expect(answers).toEqual(['removed', 'absent'])
    expect(index.vectors.size).toBe(0)
    expect(await rowOf(world, id)).toBeNull()
  })

  it('are made again by another model', async () => {
    const world = await newWorld(env.DB, 'vectors-model')
    const id = await publishedPost(world)
    await sync(world, fakeSemantic('old-model').semantic, id)
    const { semantic, embedder } = fakeSemantic('new-model')

    expect(await sync(world, semantic, id)).toBe('indexed')
    expect(embedder.calls).toHaveLength(1)
    expect((await rowOf(world, id))?.model).toBe('new-model')
  })
})

describe('the vectors subscriber', () => {
  async function delivered(semantic: Semantic | null, label: string) {
    const world = await newWorld(env.DB, label)
    const id = await publishedPost(world)
    const event = await world.db
      .prepare("SELECT id FROM outbox WHERE site_id = ?1 AND kind = 'entry.published'")
      .bind(world.tenant.key)
      .first<{ id: string }>()
    const result = await deliverEvent(
      {
        db: connect(world.db),
        site: world.tenant.site,
        clock: world.time.clock,
        fetch: async () => new Response(null, { status: 500 }),
        secret: () => undefined,
        semantic,
      },
      event?.id ?? '',
    )
    return { result, id }
  }

  it('indexes a published entry when the Worker has semantic search', async () => {
    const { semantic, index } = fakeSemantic()

    const { result, id } = await delivered(semantic, 'vectors-subscriber')

    expect(result).toEqual({ delivered: ['vectors'], failed: [] })
    expect([...index.vectors.keys()]).toEqual([`${id}:0`, `${id}:1`, `${id}:2`])
  })

  it('is no subscriber when the Worker has none', async () => {
    const { result } = await delivered(null, 'vectors-no-subscriber')

    expect(result).toEqual({ delivered: [], failed: [] })
  })
})

describe('the sweep of the cron', () => {
  it('brings in line what no event did, a limited number at a time, and leaves the rest', async () => {
    const world = await newWorld(env.DB, 'vectors-heal')
    const current = await publishedPost(world, TWO_SECTIONS, 'current')
    const missing = await publishedPost(world, TWO_SECTIONS, 'missing')
    const orphan = await publishedPost(world, TWO_SECTIONS, 'orphan')
    const moved = await publishedPost(world, TWO_SECTIONS, 'moved')
    const { semantic, embedder, index } = fakeSemantic()
    await sync(world, semantic, current)
    await sync(world, semantic, orphan)
    await sync(world, semantic, moved)
    // Published again, with no event delivered: its vectors are of the revision before.
    await world.agent.updateDraft({
      id: moved,
      version: 2,
      markdown: blogPost({ translationGroup: 'moved' }, ONE_SECTION),
    })
    expect((await world.agent.publish({ id: moved, version: 3 })).outcome).toBe('published')
    // Unpublished, with no event delivered: its vectors stay until the sweep.
    await world.agent.unpublish({ id: orphan })
    embedder.calls.length = 0
    const heal = (limit: number) =>
      healVectors(connect(world.db), semantic, {
        site: world.tenant.key,
        now: '2026-10-15T12:00:00.000Z',
        limit,
      })

    const first = await heal(1)
    const second = await heal(5)
    const third = await heal(5)

    expect([first, second, third]).toEqual([
      { synced: 1, failed: 0 },
      { synced: 2, failed: 0 },
      { synced: 0, failed: 0 },
    ])
    expect(embedder.calls).toHaveLength(2)
    expect([...index.vectors.keys()].sort()).toEqual(
      [0, 1, 2]
        .flatMap((piece) => [`${current}:${piece}`, `${missing}:${piece}`])
        .concat([`${moved}:0`, `${moved}:1`])
        .sort(),
    )
    // Another model makes every published entry stale.
    const other = fakeSemantic('other-model').semantic
    expect(
      await healVectors(connect(world.db), other, {
        site: world.tenant.key,
        now: '2026-10-15T12:00:00.000Z',
      }),
    ).toEqual({ synced: 3, failed: 0 })
  })

  it('counts an entry it could not embed, and tries it again on the next run', async () => {
    const world = await newWorld(env.DB, 'vectors-heal-fail')
    const id = await publishedPost(world)
    const { semantic } = fakeSemantic()
    const failing: Semantic = {
      index: semantic.index,
      embedder: {
        model: semantic.embedder.model,
        embed: async () => {
          throw new Error('the model is down')
        },
      },
    }
    const heal = (with_: Semantic) =>
      healVectors(connect(world.db), with_, {
        site: world.tenant.key,
        now: '2026-10-15T12:00:00.000Z',
      })

    expect(await heal(failing)).toEqual({ synced: 0, failed: 1 })
    expect(await heal(semantic)).toEqual({ synced: 1, failed: 0 })
    expect(await rowOf(world, id)).toMatchObject({ pieces: 3 })
  })
})
