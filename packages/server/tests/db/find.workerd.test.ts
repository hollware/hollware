import { env } from 'cloudflare:workers'
import { describe, expect, it } from 'vitest'

import { createD1Store } from '../../src/db/index.ts'
import { idFactory, insertEntries, newRevision, seedOwner, siteKey } from './support.ts'

// Fails when: findEntry, findEntryById or listTranslations stop reading the revision of the view
// they are asked for (head_rev for `head`, published_rev for `published`), stop returning null (or
// leaving out the entry) for an entry that is not published in the published view, drop a part of
// the natural key (collection, locale or slug), the collection or the group, or the site from
// their query, stop sorting the tags of a revision or the translations by locale, map a column
// of an entry, a revision or its actor to the wrong field (including the JSON columns parsed back
// to what was written), or listTranslations stops answering the summary of a revision (id,
// frontmatter and tags) and nothing else.

const BLOG = { collection: 'blog', locale: 'en', slug: 'edge-caching' }

describe('findEntry and findEntryById', () => {
  it('map every column of the entry, its head revision and its actor', async () => {
    const owner = await seedOwner(env.DB, siteKey('find'))
    const id = idFactory()
    await insertEntries(env.DB, owner, [
      {
        id: id('ent_a'),
        ...BLOG,
        translationGroup: 'edge-caching',
        updatedAt: '2026-10-12T10:00:00.000Z',
        revisions: [
          {
            id: id('rev_a'),
            markdown: '---\ntitle: Diseño\n---\n\n# Diseño del planificador 🚀\n',
            frontmatter: { title: 'Diseño', tags: ['b', 'a'], nested: { n: [1, 2.5, null] } },
            document: {
              nodes: [['h1', { id: 'diseño' }, 'Diseño del planificador 🚀']],
              frontmatter: { title: 'Diseño' },
              meta: { toc: true },
            },
            verdict: {
              ok: false,
              phase: 'write',
              errors: [
                {
                  contract: 'schema',
                  severity: 'error',
                  path: '/frontmatter/description',
                  message: 'Required',
                  fix: 'Add a description',
                  line: 2,
                },
              ],
              warnings: [],
              contractsHash: 'h1',
            },
            wordCount: 4,
            actorMeta: { client: { name: 'claude-code', version: '2.1' }, model: 'opus' },
            tags: ['b', 'a'],
            createdAt: '2026-10-12T09:30:00.000Z',
          },
        ],
      },
    ])
    const store = createD1Store(env.DB)

    const byKey = await store.findEntry(owner.site, BLOG, 'head')
    const byId = await store.findEntryById(owner.site, id('ent_a'), 'head')

    expect(byKey).toEqual({
      entry: {
        id: id('ent_a'),
        collection: 'blog',
        locale: 'en',
        slug: 'edge-caching',
        translationGroup: 'edge-caching',
        status: 'draft',
        version: 1,
        headRevision: id('rev_a'),
        publishedRevision: null,
        publishedAt: null,
        updatedAt: '2026-10-12T10:00:00.000Z',
      },
      revision: {
        id: id('rev_a'),
        entryId: id('ent_a'),
        markdown: '---\ntitle: Diseño\n---\n\n# Diseño del planificador 🚀\n',
        frontmatter: { title: 'Diseño', tags: ['b', 'a'], nested: { n: [1, 2.5, null] } },
        document: {
          nodes: [['h1', { id: 'diseño' }, 'Diseño del planificador 🚀']],
          frontmatter: { title: 'Diseño' },
          meta: { toc: true },
        },
        comarkVersion: '0.7.0',
        pipelineVersion: '1',
        wordCount: 4,
        verdict: {
          ok: false,
          phase: 'write',
          errors: [
            {
              contract: 'schema',
              severity: 'error',
              path: '/frontmatter/description',
              message: 'Required',
              fix: 'Add a description',
              line: 2,
            },
          ],
          warnings: [],
          contractsHash: 'h1',
        },
        tags: ['a', 'b'],
        actor: {
          kind: 'token',
          userId: owner.actor.userId,
          tokenId: owner.actor.tokenId,
          meta: { client: { name: 'claude-code', version: '2.1' }, model: 'opus' },
        },
        createdAt: '2026-10-12T09:30:00.000Z',
      },
    })
    expect(byId).toEqual(byKey)
  })

  it('gives the head revision in the head view and the published one in the published view', async () => {
    const owner = await seedOwner(env.DB, siteKey('views'))
    const id = idFactory()
    await insertEntries(env.DB, owner, [
      {
        id: id('ent_a'),
        ...BLOG,
        updatedAt: '2026-10-12T12:00:00.000Z',
        revisions: [
          { id: id('rev_1'), markdown: 'live', tags: ['news'] },
          { id: id('rev_2'), markdown: 'draft', tags: ['wip', 'ideas'] },
        ],
        published: { revision: id('rev_1'), sortKey: '2026-10-01', at: '2026-10-01T08:00:00.000Z' },
      },
    ])
    const store = createD1Store(env.DB)

    const head = await store.findEntry(owner.site, BLOG, 'head')
    const published = await store.findEntry(owner.site, BLOG, 'published')
    const publishedById = await store.findEntryById(owner.site, id('ent_a'), 'published')

    expect(head?.revision).toMatchObject({
      id: id('rev_2'),
      markdown: 'draft',
      tags: ['ideas', 'wip'],
    })
    expect(head?.entry).toMatchObject({
      status: 'published',
      headRevision: id('rev_2'),
      publishedRevision: id('rev_1'),
      publishedAt: '2026-10-01T08:00:00.000Z',
    })
    expect(published?.revision).toMatchObject({ id: id('rev_1'), markdown: 'live', tags: ['news'] })
    expect(published?.entry).toEqual(head?.entry)
    expect(publishedById).toEqual(published)
  })

  it('has no published view for an entry that is a draft', async () => {
    const owner = await seedOwner(env.DB, siteKey('draft'))
    const id = idFactory()
    await insertEntries(env.DB, owner, [
      { id: id('ent_a'), ...BLOG, updatedAt: '2026-10-12T10:00:00.000Z' },
    ])
    const store = createD1Store(env.DB)

    expect(await store.findEntry(owner.site, BLOG, 'published')).toBeNull()
    expect(await store.findEntryById(owner.site, id('ent_a'), 'published')).toBeNull()
    expect((await store.findEntry(owner.site, BLOG, 'head'))?.entry.id).toBe(id('ent_a'))
  })

  it('answers null for an entry that is not there, whichever part of the key is wrong', async () => {
    const owner = await seedOwner(env.DB, siteKey('missing'))
    const id = idFactory()
    await insertEntries(env.DB, owner, [
      { id: id('ent_a'), ...BLOG, updatedAt: '2026-10-12T10:00:00.000Z' },
    ])
    const store = createD1Store(env.DB)

    expect(await store.findEntry(owner.site, { ...BLOG, collection: 'docs' }, 'head')).toBeNull()
    expect(await store.findEntry(owner.site, { ...BLOG, locale: 'es' }, 'head')).toBeNull()
    expect(
      await store.findEntry(owner.site, { ...BLOG, slug: 'edge-caching-2' }, 'head'),
    ).toBeNull()
    expect(await store.findEntryById(owner.site, id('ent_missing'), 'head')).toBeNull()
    expect(await store.findEntry(owner.site, BLOG, 'head')).not.toBeNull()
  })

  it('reads the tags of a revision sorted by UTF-16 code unit, and none as an empty list', async () => {
    const owner = await seedOwner(env.DB, siteKey('tags'))
    const id = idFactory()
    await insertEntries(env.DB, owner, [
      {
        id: id('ent_a'),
        ...BLOG,
        updatedAt: '2026-10-12T10:00:00.000Z',
        // U+FF20 is after U+1F680 in UTF-16 code units, and before it in the UTF-8 bytes that the
        // database sorts by, so only the store's own sort gives this order.
        revisions: [{ id: id('rev_a'), tags: ['zeta', 'Alpha', '\uFF20', 'mid', '🚀', 'alpha'] }],
      },
      {
        id: id('ent_b'),
        ...BLOG,
        slug: 'no-tags',
        updatedAt: '2026-10-12T10:00:00.000Z',
        revisions: [{ id: id('rev_b'), tags: [] }],
      },
    ])
    const store = createD1Store(env.DB)

    expect((await store.findEntry(owner.site, BLOG, 'head'))?.revision.tags).toEqual([
      'Alpha',
      'alpha',
      'mid',
      'zeta',
      '🚀',
      '\uFF20',
    ])
    expect(
      (await store.findEntry(owner.site, { ...BLOG, slug: 'no-tags' }, 'head'))?.revision.tags,
    ).toEqual([])
  })
})

describe('listTranslations', () => {
  /**
   * The group `edge`: en (draft head, published at rev 1), es (published), pt (a draft), and
   * fr, in no group. The group `other`, and an `edge` group in another collection, are not it.
   */
  async function seedGroup() {
    const owner = await seedOwner(env.DB, siteKey('translations'))
    const id = idFactory()
    const at = { at: '2026-10-01T08:00:00.000Z' }
    await insertEntries(env.DB, owner, [
      {
        id: id('ent_pt'),
        locale: 'pt',
        slug: 'cache-na-borda',
        translationGroup: 'edge',
        updatedAt: '2026-10-12T10:00:00.000Z',
        revisions: [{ id: id('rev_pt'), frontmatter: { title: 'pt' }, tags: ['borda'] }],
      },
      {
        id: id('ent_en'),
        slug: 'edge-caching',
        translationGroup: 'edge',
        updatedAt: '2026-10-12T10:00:00.000Z',
        revisions: [
          { id: id('rev_en1'), frontmatter: { title: 'en live' }, tags: ['edge'] },
          { id: id('rev_en2'), frontmatter: { title: 'en draft' }, tags: ['edge', 'wip'] },
        ],
        published: { revision: id('rev_en1'), sortKey: 'k', ...at },
      },
      {
        id: id('ent_es'),
        locale: 'es',
        slug: 'cache-en-el-borde',
        translationGroup: 'edge',
        updatedAt: '2026-10-12T10:00:00.000Z',
        revisions: [{ id: id('rev_es'), frontmatter: { title: 'es' }, tags: ['borde'] }],
        published: { revision: id('rev_es'), sortKey: 'k', ...at },
      },
      {
        id: id('ent_fr'),
        locale: 'fr',
        slug: 'sans-groupe',
        updatedAt: '2026-10-12T10:00:00.000Z',
      },
      {
        id: id('ent_other'),
        slug: 'other',
        translationGroup: 'other',
        updatedAt: '2026-10-12T10:00:00.000Z',
      },
      {
        id: id('ent_docs'),
        collection: 'docs',
        slug: 'edge-caching',
        translationGroup: 'edge',
        updatedAt: '2026-10-12T10:00:00.000Z',
      },
    ])
    return { owner, id, store: createD1Store(env.DB) }
  }

  it('lists every entry of the group in the head view, one per locale in order of locale, with its head revision', async () => {
    const { owner, id, store } = await seedGroup()

    const group = await store.listTranslations(owner.site, 'blog', 'edge', 'head')

    expect(group.map((view) => [view.entry.locale, view.entry.id])).toEqual([
      ['en', id('ent_en')],
      ['es', id('ent_es')],
      ['pt', id('ent_pt')],
    ])
    // A summary of each head revision: its id, frontmatter and tags, and nothing else.
    expect(group.map((view) => view.revision)).toEqual([
      { id: id('rev_en2'), frontmatter: { title: 'en draft' }, tags: ['edge', 'wip'] },
      { id: id('rev_es'), frontmatter: { title: 'es' }, tags: ['borde'] },
      { id: id('rev_pt'), frontmatter: { title: 'pt' }, tags: ['borda'] },
    ])
    expect(group.map((view) => view.entry.status)).toEqual(['published', 'published', 'draft'])
  })

  it('lists only the published entries of the group in the published view, each with its published revision', async () => {
    const { owner, id, store } = await seedGroup()

    const group = await store.listTranslations(owner.site, 'blog', 'edge', 'published')

    expect(group.map((view) => [view.entry.locale, view.entry.id])).toEqual([
      ['en', id('ent_en')],
      ['es', id('ent_es')],
    ])
    expect(group.map((view) => view.revision)).toEqual([
      { id: id('rev_en1'), frontmatter: { title: 'en live' }, tags: ['edge'] },
      { id: id('rev_es'), frontmatter: { title: 'es' }, tags: ['borde'] },
    ])
  })

  it('has nothing for a group that is not there, or that is in another collection', async () => {
    const { owner, id, store } = await seedGroup()

    expect(await store.listTranslations(owner.site, 'blog', 'nothing', 'head')).toEqual([])
    expect(await store.listTranslations(owner.site, 'news', 'edge', 'head')).toEqual([])
    expect(
      (await store.listTranslations(owner.site, 'docs', 'edge', 'head')).map(
        (view) => view.entry.id,
      ),
    ).toEqual([id('ent_docs')])
    expect(await store.listTranslations(owner.site, 'docs', 'edge', 'published')).toEqual([])
  })
})

describe('a store on a D1 session', () => {
  it('reads and writes through the session it was given, not around it', async () => {
    const owner = await seedOwner(env.DB, siteKey('session'))
    const id = idFactory()
    await insertEntries(env.DB, owner, [
      { id: id('ent_a'), ...BLOG, updatedAt: '2026-10-12T10:00:00.000Z' },
    ])
    const session = env.DB.withSession('first-unconstrained')
    const store = createD1Store(session)
    expect(session.getBookmark()).toBeNull()

    const found = await store.findEntry(owner.site, BLOG, 'head')
    const afterRead = session.getBookmark()
    const created = await store.createEntry(owner.site, {
      collection: 'blog',
      locale: 'en',
      slug: 'written-through-the-session',
      translationGroup: null,
      revision: newRevision(owner.actor),
    })
    const afterWrite = session.getBookmark()

    expect(found?.entry.id).toBe(id('ent_a'))
    expect(created.outcome).toBe('saved')
    expect(afterRead).not.toBeNull()
    expect(afterWrite !== null && afterRead !== null && afterWrite > afterRead).toBe(true)
  })
})
