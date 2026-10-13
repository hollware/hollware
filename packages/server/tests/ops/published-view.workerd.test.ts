import { env } from 'cloudflare:workers'
import { beforeAll, describe, expect, it, vi } from 'vitest'

import { blogPost, warmUpComark } from './support.ts'
import { createPost, newWorld, publishPost } from './world.ts'

// Fails when: a handler that reads stops reading the view of its context. get-entry.ts,
// list-entries.ts and get-translations.ts pass `context.view` to the store: with the head view
// hard-wired, a site that reads over the RPC binding (the published view) would see drafts,
// their latest unpublished revision, and entries that were unpublished.

vi.setConfig({ testTimeout: 60_000 })
beforeAll(warmUpComark, 120_000)

/** Two published pairs' worth of content: one pair live, one half live, and a draft on its own. */
async function site(label: string) {
  const world = await newWorld(env.DB, label)
  const alphaEn = await createPost(world, {
    slug: 'alpha',
    group: 'alpha',
    date: '2026-09-01',
    tags: '[cloudflare, cms]',
    at: '2026-10-13T10:00:00.000Z',
  })
  const alphaEs = await createPost(world, {
    slug: 'alfa',
    locale: 'es',
    group: 'alpha',
    date: '2026-09-02',
    tags: '[cloudflare, cms]',
    at: '2026-10-13T10:01:00.000Z',
  })
  const betaEn = await createPost(world, {
    slug: 'beta',
    group: 'beta',
    date: '2026-09-29',
    tags: '[cms]',
    at: '2026-10-13T10:02:00.000Z',
  })
  const betaEs = await createPost(world, {
    slug: 'beta-es',
    locale: 'es',
    group: 'beta',
    date: '2026-09-30',
    tags: '[cms]',
    at: '2026-10-13T10:03:00.000Z',
  })
  const gamma = await createPost(world, {
    slug: 'gamma',
    group: 'gamma',
    date: '2026-10-05',
    tags: '[cms]',
    at: '2026-10-13T10:04:00.000Z',
  })
  const live = {
    alphaEn: await publishPost(world, alphaEn, '2026-10-13T11:00:00.000Z'),
    alphaEs: await publishPost(world, alphaEs, '2026-10-13T11:01:00.000Z'),
    betaEn: await publishPost(world, betaEn, '2026-10-13T11:02:00.000Z'),
  }
  return { world, live, drafts: { betaEs, gamma } }
}

describe('get_entry in the published view', () => {
  it('finds a published entry, and answers not_found for a draft that the head view finds', async () => {
    const { world } = await site('view-get')
    const key = (slug: string, locale: string) => ({ collection: 'blog', locale, slug })

    const live = await world.reader.getEntry(key('alpha', 'en'))
    const draft = await world.reader.getEntry(key('gamma', 'en'))
    const halfLive = await world.reader.getEntry(key('beta-es', 'es'))
    const asAgent = await world.agent.getEntry(key('gamma', 'en'))

    expect(live.outcome).toBe('ok')
    expect(live.entry?.status).toBe('published')
    expect(draft).toEqual({ outcome: 'not_found' })
    expect(halfLive).toEqual({ outcome: 'not_found' })
    expect(asAgent.outcome).toBe('ok')
    expect(asAgent.entry?.status).toBe('draft')
  })

  it('shows the revision that is live, not a later one that is not published yet', async () => {
    const { world, live } = await site('view-live')
    const edited = await world.agent.updateDraft({
      id: live.alphaEn.id,
      version: live.alphaEn.version,
      markdown: blogPost({ title: 'A title nobody has approved', translationGroup: 'alpha' }),
    })
    const english = { collection: 'blog', locale: 'en', slug: 'alpha' }

    const asReader = await world.reader.getEntry({ ...english, formats: ['markdown'] })
    const asAgent = await world.agent.getEntry({ ...english, formats: ['markdown'] })

    expect(edited.outcome).toBe('saved')
    expect(asReader.entry?.frontmatter['title']).toBe('Post alpha')
    expect(asReader.entry?.markdown).toContain('title: Post alpha\n')
    expect(asReader.entry?.hasUnpublishedChanges).toBe(true)
    expect(asAgent.entry?.frontmatter['title']).toBe('A title nobody has approved')
    expect(asAgent.entry?.revision).not.toBe(asReader.entry?.revision)
  })

  it('stops finding an entry once it is unpublished', async () => {
    const { world, live } = await site('view-unpublish')
    const english = { collection: 'blog', locale: 'en', slug: 'alpha' }
    expect((await world.reader.getEntry(english)).outcome).toBe('ok')

    const unpublished = await world.agent.unpublish({ id: live.alphaEn.id })

    expect(unpublished.outcome).toBe('unpublished')
    expect(await world.reader.getEntry(english)).toEqual({ outcome: 'not_found' })
    expect((await world.agent.getEntry(english)).entry?.status).toBe('draft')
  })
})

describe('list_entries in the published view', () => {
  it('lists the published entries only, newest first by their sorting field', async () => {
    const { world, live } = await site('view-list')

    const page = await world.reader.listEntries({ collection: 'blog' })
    const asAgent = await world.agent.listEntries({ collection: 'blog' })

    // The sorting field of the blog is its date, so the order is not the order of publication.
    expect(page.entries.map((entry) => entry.slug)).toEqual(['beta', 'alfa', 'alpha'])
    expect(page.entries).toEqual([live.betaEn, live.alphaEs, live.alphaEn])
    expect(page.nextCursor).toBeNull()
    expect(asAgent.entries).toHaveLength(5)
  })

  it('lists nothing for a status that is not published', async () => {
    const { world } = await site('view-status')

    const drafts = await world.reader.listEntries({ collection: 'blog', status: 'draft' })
    const published = await world.reader.listEntries({ collection: 'blog', status: 'published' })

    expect(drafts).toEqual({ outcome: 'ok', entries: [], nextCursor: null })
    expect(published.entries).toHaveLength(3)
  })

  it('lists by tag over two pages of a cursor, and by locale', async () => {
    const { world, live } = await site('view-tag')

    const first = await world.reader.listEntries({ collection: 'blog', tag: 'cms', limit: 2 })
    const second = await world.reader.listEntries({
      collection: 'blog',
      tag: 'cms',
      limit: 2,
      cursor: first.nextCursor ?? '',
    })
    const spanish = await world.reader.listEntries({ collection: 'blog', locale: 'es' })

    expect(first.entries).toEqual([live.betaEn, live.alphaEs])
    expect(first.nextCursor).toEqual(expect.any(String))
    expect(second).toEqual({ outcome: 'ok', entries: [live.alphaEn], nextCursor: null })
    expect(spanish.entries).toEqual([live.alphaEs])
  })

  it('does not list an entry that was unpublished', async () => {
    const { world, live } = await site('view-list-unpublish')
    await world.agent.unpublish({ id: live.betaEn.id })

    const page = await world.reader.listEntries({ collection: 'blog' })

    expect(page.entries.map((entry) => entry.slug)).toEqual(['alfa', 'alpha'])
  })
})

describe('get_translations in the published view', () => {
  it('gives the published translations of a group: the pair, and only the live half of another', async () => {
    const { world, live } = await site('view-translations')

    const pair = await world.reader.getTranslations({
      collection: 'blog',
      translationGroup: 'alpha',
    })
    const half = await world.reader.getTranslations({
      collection: 'blog',
      translationGroup: 'beta',
    })
    const draft = await world.reader.getTranslations({
      collection: 'blog',
      translationGroup: 'gamma',
    })
    const asAgent = await world.agent.getTranslations({
      collection: 'blog',
      translationGroup: 'beta',
    })

    expect(pair).toEqual({ outcome: 'ok', entries: [live.alphaEn, live.alphaEs] })
    expect(half).toEqual({ outcome: 'ok', entries: [live.betaEn] })
    expect(draft).toEqual({ outcome: 'not_found' })
    expect(asAgent.entries?.map((entry) => entry.locale)).toEqual(['en', 'es'])
  })
})
