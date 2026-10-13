import { env } from 'cloudflare:workers'
import { describe, expect, it } from 'vitest'

import { createD1Store } from '../../src/db/index.ts'
import { MAX_BOUND_PARAMETERS } from '../../src/limits.ts'
import {
  idFactory,
  insertEntries,
  placeholders,
  recordStatements,
  seedOwner,
  siteKey,
} from './support.ts'

// Fails when: src/db/reads.ts lookup stops answering in the order of the refs it was given, with
// null for an entry that is not there, and once for each time a ref was asked; cuts its refs into
// chunks that bind more than MAX_BOUND_PARAMETERS values (the site, and three per ref: 29 refs
// to a statement) or sends the chunks in separate calls instead of one batch; drops a part of the
// natural key (collection, locale, slug) or the site; or `translations` stops listing every entry
// of the group of that collection, one per locale in order of locale, with its facts.

const NOW = '2026-10-12T10:00:00.000Z'

const pad = (n: number) => String(n).padStart(2, '0')

describe('lookup(site).lookupMany', () => {
  it('answers 60 refs in the order asked, with null where there is no entry, in chunks under the limit', async () => {
    const owner = await seedOwner(env.DB, siteKey('lookup-many'))
    const id = idFactory()
    // Posts 1 to 60 are asked for; every third one (3, 6, 9, …) has no entry.
    const asked = Array.from({ length: 60 }, (_, i) => i + 1)
    await insertEntries(
      env.DB,
      owner,
      asked
        .filter((n) => n % 3 !== 0)
        .map((n) => ({
          id: id(`ent_${pad(n)}`),
          slug: `post-${pad(n)}`,
          translationGroup: n % 2 === 0 ? `group-${pad(n)}` : null,
          updatedAt: NOW,
        })),
    )
    const { db, prepared, batches } = recordStatements(env.DB)
    const store = createD1Store(db)

    const facts = await store
      .lookup(owner.site)
      .lookupMany(asked.map((n) => ({ collection: 'blog', locale: 'en', slug: `post-${pad(n)}` })))

    expect(facts).toEqual(
      asked.map((n) =>
        n % 3 === 0
          ? null
          : {
              id: id(`ent_${pad(n)}`),
              status: 'draft',
              translationGroup: n % 2 === 0 ? `group-${pad(n)}` : null,
            },
      ),
    )
    // 60 refs are 29 + 29 + 2: the site and three values per ref are 88, 88 and 7 bound values.
    expect(prepared.map(placeholders)).toEqual([88, 88, 7])
    expect(Math.max(...prepared.map(placeholders))).toBeLessThanOrEqual(MAX_BOUND_PARAMETERS)
    expect(batches).toEqual([3])
  })

  it('answers each ref as many times as it was asked, and binds it once', async () => {
    const owner = await seedOwner(env.DB, siteKey('lookup-dup'))
    const id = idFactory()
    await insertEntries(env.DB, owner, [
      { id: id('ent_a'), slug: 'a', updatedAt: NOW },
      { id: id('ent_b'), slug: 'b', updatedAt: NOW },
      { id: id('ent_c'), slug: 'c', updatedAt: NOW },
    ])
    const { db, prepared } = recordStatements(env.DB)
    const ref = (slug: string) => ({ collection: 'blog', locale: 'en', slug })

    const facts = await createD1Store(db)
      .lookup(owner.site)
      .lookupMany([ref('c'), ref('a'), ref('a'), ref('missing'), ref('b'), ref('missing')])

    expect(facts.map((fact) => fact?.id ?? null)).toEqual([
      id('ent_c'),
      id('ent_a'),
      id('ent_a'),
      null,
      id('ent_b'),
      null,
    ])
    // The site and three values for each of the four different refs.
    expect(prepared.map(placeholders)).toEqual([13])
  })

  it('asks nothing for no refs', async () => {
    const owner = await seedOwner(env.DB, siteKey('lookup-none'))
    const { db, prepared, batches } = recordStatements(env.DB)

    expect(await createD1Store(db).lookup(owner.site).lookupMany([])).toEqual([])
    expect([prepared, batches]).toEqual([[], []])
  })

  it('finds an entry only by its whole key, and tells the status and the translation group', async () => {
    const owner = await seedOwner(env.DB, siteKey('lookup-key'))
    const id = idFactory()
    await insertEntries(env.DB, owner, [
      { id: id('ent_a'), slug: 'a', translationGroup: 'g', updatedAt: NOW },
      {
        id: id('ent_b'),
        slug: 'b',
        updatedAt: NOW,
        published: { revision: `rev_${id('ent_b')}`, sortKey: 'k', at: NOW },
      },
    ])
    const store = createD1Store(env.DB)

    expect(
      await store.lookup(owner.site).lookupMany([
        { collection: 'blog', locale: 'en', slug: 'a' },
        { collection: 'blog', locale: 'en', slug: 'b' },
        { collection: 'docs', locale: 'en', slug: 'a' },
        { collection: 'blog', locale: 'es', slug: 'a' },
        { collection: 'blog', locale: 'en', slug: 'c' },
      ]),
    ).toEqual([
      { id: id('ent_a'), status: 'draft', translationGroup: 'g' },
      { id: id('ent_b'), status: 'published', translationGroup: null },
      null,
      null,
      null,
    ])
  })
})

describe('lookup(site).translations', () => {
  it('lists the entries of a group of a collection, one per locale in order of locale, with their facts', async () => {
    const owner = await seedOwner(env.DB, siteKey('lookup-group'))
    const id = idFactory()
    await insertEntries(env.DB, owner, [
      {
        id: id('ent_pt'),
        locale: 'pt',
        slug: 'cache-na-borda',
        translationGroup: 'edge',
        updatedAt: NOW,
        published: { revision: `rev_${id('ent_pt')}`, sortKey: 'k', at: NOW },
      },
      {
        id: id('ent_en'),
        locale: 'en',
        slug: 'edge-caching',
        translationGroup: 'edge',
        updatedAt: NOW,
      },
      {
        id: id('ent_es'),
        locale: 'es',
        slug: 'cache-en-el-borde',
        translationGroup: 'edge',
        updatedAt: NOW,
        published: { revision: `rev_${id('ent_es')}`, sortKey: 'k', at: NOW },
      },
      {
        id: id('ent_other'),
        locale: 'en',
        slug: 'other',
        translationGroup: 'other',
        updatedAt: NOW,
      },
      {
        id: id('ent_docs'),
        collection: 'docs',
        locale: 'en',
        slug: 'edge-caching',
        translationGroup: 'edge',
        updatedAt: NOW,
      },
      { id: id('ent_none'), locale: 'fr', slug: 'sans-groupe', updatedAt: NOW },
    ])
    const lookup = createD1Store(env.DB).lookup(owner.site)

    expect(await lookup.translations('blog', 'edge')).toEqual([
      {
        collection: 'blog',
        locale: 'en',
        slug: 'edge-caching',
        id: id('ent_en'),
        status: 'draft',
        translationGroup: 'edge',
      },
      {
        collection: 'blog',
        locale: 'es',
        slug: 'cache-en-el-borde',
        id: id('ent_es'),
        status: 'published',
        translationGroup: 'edge',
      },
      {
        collection: 'blog',
        locale: 'pt',
        slug: 'cache-na-borda',
        id: id('ent_pt'),
        status: 'published',
        translationGroup: 'edge',
      },
    ])
    expect(await lookup.translations('blog', 'nothing')).toEqual([])
    expect((await lookup.translations('docs', 'edge')).map((entry) => entry.id)).toEqual([
      id('ent_docs'),
    ])
  })
})
