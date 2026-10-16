import { env } from 'cloudflare:workers'
import { beforeAll, describe, expect, it, vi } from 'vitest'

import { blogPost, NO_ENTRY, warmUpComark } from './support.ts'
import { createPost, newWorld, publishPost, snapshotOf, START, type World } from './world.ts'

// Fails when: the trash of entries stops working the way the specs say. trash.ts answers published
// to an entry that is published or scheduled, and conflict to a stale version, writing nothing;
// writes.ts trashes only a draft out of the trash at its version, cancels its pending review in the same batch
// (cancelPendingReview with the state of the trash), and restores only an entry in the trash, at
// the next version; reads.ts leaves an entry in the trash out of every read of the head view (by
// key, by id, listings, translations) and of the lookups the contracts read, lists only the
// trash with trashed, and nothing for trashed in the published view; holderOfNewEntry answers in_trash for a slug or a translation that an entry
// in the trash holds; list_reviews leaves out the reviews of an entry in the trash; and every
// statement of the trash carries the site of the call. D1 is real.

vi.setConfig({ testTimeout: 60_000 })
beforeAll(warmUpComark, 120_000)

const T1 = '2026-10-13T11:00:00.000Z'
const T2 = '2026-10-13T12:00:00.000Z'
const LATER = '2026-10-14T12:00:00.000Z'

/** An English post and its Spanish translation, both drafts, which the blog needs to publish. */
async function pair(world: World) {
  const en = await createPost(world, { slug: 'edge-caching-guide', group: 'edge-caching-guide' })
  const es = await createPost(world, {
    slug: 'guia-de-cache',
    locale: 'es',
    group: 'edge-caching-guide',
  })
  return { en, es }
}

/** The status of the reviews of an entry, oldest first. */
async function reviewStatuses(world: World, entryId: string): Promise<string[]> {
  const { results } = await world.db
    .prepare('SELECT status FROM reviews WHERE entry_id = ? ORDER BY rowid')
    .bind(entryId)
    .all<{ status: string }>()
  return results.map((row) => row.status)
}

describe('delete_entry', () => {
  it('moves a draft to the trash at the next version, and cancels its pending review', async () => {
    const world = await newWorld(env.DB, 'trash-draft')
    const { en } = await pair(world)
    const asked = await world.agent.requestReview({ id: en.id, version: 1 })
    world.time.set(T1)

    const answer = await world.agent.deleteEntry({ id: en.id, version: 1 })

    expect(asked.outcome).toBe('pending_review')
    expect(answer).toMatchObject({
      outcome: 'trashed',
      entry: {
        id: en.id,
        slug: 'edge-caching-guide',
        status: 'draft',
        version: 2,
        deletedAt: T1,
        updatedAt: T1,
      },
    })
    expect(await reviewStatuses(world, en.id)).toEqual(['cancelled'])
    // Nothing is deleted: the entry keeps its row and its revision.
    expect(
      await world.db
        .prepare('SELECT count(*) AS n FROM revisions WHERE entry_id = ?')
        .bind(en.id)
        .first('n'),
    ).toBe(1)
  })

  it('answers published to a published entry, and writes nothing', async () => {
    const world = await newWorld(env.DB, 'trash-published')
    const { en } = await pair(world)
    const live = await publishPost(world, en)
    const before = await snapshotOf(world.db, world.tenant.key)

    const answer = await world.agent.deleteEntry({ id: en.id, version: live.version })

    expect(answer).toMatchObject({
      outcome: 'published',
      entry: { id: en.id, status: 'published', version: 2, deletedAt: null },
    })
    expect(await snapshotOf(world.db, world.tenant.key)).toEqual(before)
  })

  it('answers published to a scheduled entry, and writes nothing', async () => {
    const world = await newWorld(env.DB, 'trash-scheduled')
    const { en } = await pair(world)
    const scheduled = await world.agent.publish({ id: en.id, version: 1, publishAt: LATER })
    const before = await snapshotOf(world.db, world.tenant.key)

    const answer = await world.agent.deleteEntry({ id: en.id, version: 2 })

    expect(scheduled.outcome).toBe('scheduled')
    expect(answer).toMatchObject({
      outcome: 'published',
      entry: { id: en.id, status: 'scheduled', version: 2 },
    })
    expect(await snapshotOf(world.db, world.tenant.key)).toEqual(before)
  })

  it('answers conflict to a version it is not at, and not_found to an entry that is not there', async () => {
    const world = await newWorld(env.DB, 'trash-stale')
    const { en } = await pair(world)
    const before = await snapshotOf(world.db, world.tenant.key)

    const stale = await world.agent.deleteEntry({ id: en.id, version: 2 })
    const missing = await world.agent.deleteEntry({ id: NO_ENTRY, version: 1 })

    expect(stale).toEqual({
      outcome: 'conflict',
      conflict: { currentVersion: 1, headRevision: expect.stringMatching(/^rev_/) },
    })
    expect(missing).toEqual({ outcome: 'not_found' })
    expect(await snapshotOf(world.db, world.tenant.key)).toEqual(before)
  })

  it('keeps the review of a published entry pending at the store, which trashes only drafts', async () => {
    const world = await newWorld(env.DB, 'trash-store-published')
    const { en } = await pair(world)
    const live = await publishPost(world, en)
    await world.agent.updateDraft({
      id: en.id,
      version: live.version,
      markdown: blogPost({ translationGroup: 'edge-caching-guide', title: 'Edge caching, again' }),
    })
    await world.agent.requestReview({ id: en.id, version: 3 })

    const answer = await world.store.trashEntry(world.tenant.key, {
      entryId: en.id,
      expectedVersion: 3,
    })

    expect(answer).toMatchObject({ outcome: 'not_draft', view: { entry: { version: 3 } } })
    expect(await reviewStatuses(world, en.id)).toEqual(['pending'])
  })
})

describe('an entry in the trash', () => {
  async function trashed(label: string) {
    const world = await newWorld(env.DB, label)
    const { en, es } = await pair(world)
    const answer = await world.store.trashEntry(world.tenant.key, {
      entryId: es.id,
      expectedVersion: 1,
    })
    if (answer.outcome !== 'trashed') throw new Error(JSON.stringify(answer))
    return { world, en, es }
  }

  it('is not there for get_entry, update_draft, publish, unpublish, request_review or get_translations', async () => {
    const { world, es } = await trashed('trash-gone')
    const markdown = blogPost({ translationGroup: 'edge-caching-guide', title: 'Otra vez' })

    const answers = [
      await world.agent.getEntry({ collection: 'blog', locale: 'es', slug: 'guia-de-cache' }),
      await world.agent.updateDraft({ id: es.id, version: 2, markdown }),
      await world.agent.publish({ id: es.id, version: 2 }),
      await world.agent.unpublish({ id: es.id }),
      await world.agent.requestReview({ id: es.id, version: 2 }),
      await world.agent.deleteEntry({ id: es.id, version: 2 }),
    ]
    const translations = await world.agent.getTranslations({
      collection: 'blog',
      translationGroup: 'edge-caching-guide',
    })

    expect(answers).toEqual(Array.from({ length: 6 }, () => ({ outcome: 'not_found' })))
    expect(translations.entries?.map((entry) => entry.slug)).toEqual(['edge-caching-guide'])
  })

  it('is left out of list_entries, and is all that trashed lists', async () => {
    const { world, en, es } = await trashed('trash-list')

    // A published note, which no listing of the trash has: the trash holds drafts only.
    const note = await world.agent.createDraft({
      collection: 'notes',
      locale: 'en',
      slug: 'a-note',
      markdown: '---\ntitle: A note\n---\nText.\n',
    })
    await world.agent.publish({ id: note.entry?.id ?? '', version: 1 })
    const listed = await world.agent.listEntries({ collection: 'blog' })
    const drafts = await world.agent.listEntries({ collection: 'blog', status: 'draft' })
    const trash = await world.agent.listEntries({ collection: 'blog', trashed: true })
    const live = await world.reader.listEntries({ collection: 'notes', trashed: true })
    const notes = await world.reader.listEntries({ collection: 'notes' })

    expect(listed.entries.map((entry) => entry.id)).toEqual([en.id])
    expect(drafts.entries.map((entry) => entry.id)).toEqual([en.id])
    expect(trash.entries.map((entry) => [entry.id, entry.version, entry.deletedAt])).toEqual([
      [es.id, 2, START],
    ])
    expect(live).toEqual({ outcome: 'ok', entries: [], nextCursor: null })
    expect(notes.entries.map((entry) => entry.slug)).toEqual(['a-note'])
  })

  it('counts for nothing in the contracts: its translation and the links to it are missing', async () => {
    const { world, en } = await trashed('trash-contracts')

    const blocked = await world.agent.publish({ id: en.id, version: 1 })
    const linked = await world.agent.validate({
      collection: 'blog',
      locale: 'en',
      slug: 'a-post-to-check',
      markdown: blogPost(
        { translationGroup: 'edge-caching-guide' },
        '\nSee [the guide](/blog/guia-de-cache/).\n',
      ),
    })

    expect(blocked.outcome).toBe('blocked')
    expect(blocked.verdict?.errors.map((error) => error.message)).toEqual([
      'The es version of the translation group "edge-caching-guide" does not exist.',
    ])
    expect(linked.verdict.errors.map((error) => error.message)).toContain(
      'The link "/blog/guia-de-cache/" points at the entry blog/es/guia-de-cache, which does not exist.',
    )
  })

  it('keeps its slug and its translation: create_draft answers in_trash with it, and writes nothing', async () => {
    const { world, es } = await trashed('trash-slug')
    const before = await snapshotOf(world.db, world.tenant.key)
    const create = (slug: string) =>
      world.agent.createDraft({
        collection: 'blog',
        locale: 'es',
        slug,
        markdown: blogPost({ translationGroup: 'edge-caching-guide' }),
      })

    const sameSlug = await create('guia-de-cache')
    const sameGroup = await create('otra-guia')

    for (const answer of [sameSlug, sameGroup]) {
      expect(answer).toMatchObject({
        outcome: 'in_trash',
        entry: { id: es.id, slug: 'guia-de-cache', version: 2, deletedAt: START },
      })
    }
    expect(await snapshotOf(world.db, world.tenant.key)).toEqual(before)
  })

  it('takes its reviews out of list_reviews', async () => {
    const world = await newWorld(env.DB, 'trash-reviews')
    const { en } = await pair(world)
    await world.agent.requestReview({ id: en.id, version: 1 })
    const listed = await world.agent.listReviews({ status: 'pending' })

    await world.agent.deleteEntry({ id: en.id, version: 1 })

    expect(listed.reviews.map((review) => review.entryId)).toEqual([en.id])
    expect(await world.agent.listReviews({ status: 'pending' })).toEqual({
      outcome: 'ok',
      reviews: [],
    })
    expect(await world.agent.listReviews({ status: 'cancelled' })).toEqual({
      outcome: 'ok',
      reviews: [],
    })
  })
})

describe('restore_entry', () => {
  it('brings it back as the draft it was, at the next version, where every read finds it', async () => {
    const world = await newWorld(env.DB, 'trash-restore')
    const { es } = await pair(world)
    await world.agent.deleteEntry({ id: es.id, version: 1 })
    world.time.set(T2)

    const answer = await world.agent.restoreEntry({ id: es.id })
    const again = await world.agent.restoreEntry({ id: es.id })
    const found = await world.agent.getEntry({
      collection: 'blog',
      locale: 'es',
      slug: 'guia-de-cache',
    })
    const listed = await world.agent.listEntries({ collection: 'blog', locale: 'es' })
    const trash = await world.agent.listEntries({ collection: 'blog', trashed: true })

    expect(answer).toMatchObject({
      outcome: 'restored',
      entry: { id: es.id, status: 'draft', version: 3, deletedAt: null, updatedAt: T2 },
    })
    expect(again).toMatchObject({ outcome: 'not_trashed', entry: { id: es.id, version: 3 } })
    expect(found.entry).toMatchObject({ id: es.id, version: 3, markdown: expect.any(String) })
    expect(listed.entries.map((entry) => entry.id)).toEqual([es.id])
    expect(trash.entries).toEqual([])
    expect(await world.agent.restoreEntry({ id: NO_ENTRY })).toEqual({ outcome: 'not_found' })
  })
})

describe('the trash of another site', () => {
  it('is out of reach: a stranger can neither trash nor restore an entry, and nothing changes', async () => {
    const home = await newWorld(env.DB, 'trash-home')
    const stranger = await newWorld(env.DB, 'trash-stranger')
    const { en, es } = await pair(home)
    await home.agent.deleteEntry({ id: es.id, version: 1 })
    const before = await snapshotOf(home.db, home.tenant.key)

    const trashing = await stranger.agent.deleteEntry({ id: en.id, version: 1 })
    const restoring = await stranger.agent.restoreEntry({ id: es.id })
    const atTheStore = await stranger.store.trashEntry(stranger.tenant.key, {
      entryId: en.id,
      expectedVersion: 1,
    })

    expect([trashing, restoring, atTheStore]).toEqual([
      { outcome: 'not_found' },
      { outcome: 'not_found' },
      { outcome: 'not_found' },
    ])
    expect(await snapshotOf(home.db, home.tenant.key)).toEqual(before)
    expect(await home.agent.restoreEntry({ id: es.id })).toMatchObject({ outcome: 'restored' })
  })
})
