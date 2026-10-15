import { env } from 'cloudflare:workers'
import { describe, expect, it } from 'vitest'

import { createD1Store } from '../../src/db/index.ts'
import { ftsQuery } from '../../src/db/reads.ts'
import type { ContentStore } from '../../src/ports.ts'
import { fixedClock, newRevision, seedOwner, siteKey, VERDICT, type Owner } from './support.ts'

// Fails when: the full-text index (migrations/0008_search.sql) stops following what is published:
// a published entry is not found by a word of its title, its tags or its text (the text taken from
// the document's text nodes, never from its Markdown marks or attributes), a word without its
// accent does not find it, a draft or an unpublished entry is found, or an entry of another site
// is; or searchEntries (src/db/reads.ts) stops ranking a match in the title over one in the text,
// narrowing to a collection and a locale, keeping to its limit, answering the entry's summary with
// a snippet that marks the match, or keeping FTS5's own syntax out of what someone typed (ftsQuery).

interface Page {
  readonly slug: string
  readonly title: string
  readonly text: string
  readonly tags?: readonly string[]
  readonly locale?: string
  readonly collection?: string
}

async function world(label: string) {
  const owner = await seedOwner(env.DB, siteKey(label))
  const store = createD1Store(env.DB, { clock: fixedClock('2026-10-15T10:00:00.000Z').clock })
  return { owner, store }
}

/** Creates a page and, unless `draft`, publishes it. */
async function page(
  store: ContentStore,
  owner: Owner,
  spec: Page,
  { draft = false }: { draft?: boolean } = {},
): Promise<string> {
  const frontmatter = { title: spec.title }
  const saved = await store.createEntry(owner.site, {
    collection: spec.collection ?? 'blog',
    locale: spec.locale ?? 'en',
    slug: spec.slug,
    translationGroup: null,
    revision: newRevision(owner.actor, {
      markdown: `---\ntitle: ${spec.title}\n---\n\n${spec.text}\n`,
      frontmatter,
      // An attribute and a link target: words that are no text of the page.
      document: {
        frontmatter,
        meta: {},
        nodes: [
          ['h1', { id: 'heading-attribute' }, spec.title],
          ['p', {}, spec.text, ['a', { href: '/hidden-target/' }, ' read more']],
        ],
      },
      tags: spec.tags ?? [],
    }),
  })
  if (saved.outcome !== 'saved') throw new Error(`${spec.slug} was not saved`)
  if (!draft) {
    const published = await store.publish(owner.site, {
      entryId: saved.view.entry.id,
      expectedVersion: saved.view.entry.version,
      verdict: VERDICT,
      acknowledged: [],
      actor: owner.actor,
      sortKey: '2026-10-15',
    })
    if (published.outcome !== 'published') throw new Error(`${spec.slug} was not published`)
  }
  return saved.view.entry.id
}

const slugs = (hits: readonly { entry: { entry: { slug: string } } }[]) =>
  hits.map((hit) => hit.entry.entry.slug)

describe('full-text search', () => {
  it('finds a published entry by a word of its title, its tags or its text, and not by its marks', async () => {
    const { owner, store } = await world('search-words')
    await page(store, owner, {
      slug: 'edge',
      title: 'Caching at the edge',
      text: 'Workers answer close to the reader.',
      tags: ['performance'],
    })
    const search = (text: string) =>
      store.searchEntries(owner.site, { text, limit: 10 }).then(slugs)

    expect(await search('caching')).toEqual(['edge'])
    expect(await search('reader')).toEqual(['edge'])
    expect(await search('performance')).toEqual(['edge'])
    // An attribute and a link target are not text of the page.
    expect(await search('attribute')).toEqual([])
    expect(await search('hidden')).toEqual([])
  })

  it('finds "migración" with "migracion", and needs every word', async () => {
    const { owner, store } = await world('search-accents')
    await page(store, owner, {
      slug: 'migrar',
      title: 'Migración de datos',
      text: 'Sin perder nada.',
      locale: 'es',
    })

    const accentless = await store.searchEntries(owner.site, { text: 'migracion', limit: 10 })
    const both = await store.searchEntries(owner.site, { text: 'migracion nada', limit: 10 })
    const missing = await store.searchEntries(owner.site, { text: 'migracion mañana', limit: 10 })

    expect([slugs(accentless), slugs(both), slugs(missing)]).toEqual([['migrar'], ['migrar'], []])
  })

  it('finds what is published only: not a draft, not what was unpublished, not another site', async () => {
    const { owner, store } = await world('search-published')
    const other = await world('search-published-other')
    await page(
      store,
      owner,
      { slug: 'draft', title: 'Kept as a draft', text: 'Lighthouse.' },
      { draft: true },
    )
    const gone = await page(store, owner, {
      slug: 'gone',
      title: 'Taken down',
      text: 'Lighthouse.',
    })
    await page(other.store, other.owner, {
      slug: 'theirs',
      title: 'Their lighthouse',
      text: 'Lighthouse.',
    })
    await store.unpublish(owner.site, { entryId: gone, actor: owner.actor })

    expect(await store.searchEntries(owner.site, { text: 'lighthouse', limit: 10 })).toEqual([])
    expect(
      slugs(await other.store.searchEntries(other.owner.site, { text: 'lighthouse', limit: 10 })),
    ).toEqual(['theirs'])
  })

  it('follows a new publication: the old words go, and the entry is found once', async () => {
    const { owner, store } = await world('search-republish')
    const id = await page(store, owner, { slug: 'moves', title: 'Harbour', text: 'Old words.' })
    const head = await store.findEntryById(owner.site, id, 'head')
    if (head === null) throw new Error('the entry is gone')
    const appended = await store.appendRevision(owner.site, {
      entryId: id,
      expectedVersion: head.entry.version,
      translationGroup: null,
      revision: newRevision(owner.actor, {
        markdown: '---\ntitle: Harbour\n---\n\nNew words.\n',
        frontmatter: { title: 'Harbour' },
        document: { frontmatter: { title: 'Harbour' }, meta: {}, nodes: [['p', {}, 'New words.']] },
      }),
    })
    if (appended.outcome !== 'saved') throw new Error('the revision was not saved')
    await store.publish(owner.site, {
      entryId: id,
      expectedVersion: appended.view.entry.version,
      verdict: VERDICT,
      acknowledged: [],
      actor: owner.actor,
      sortKey: '2026-10-15',
    })

    const old = await store.searchEntries(owner.site, { text: 'old', limit: 10 })
    const title = await store.searchEntries(owner.site, { text: 'harbour', limit: 10 })

    expect([slugs(old), slugs(title)]).toEqual([[], ['moves']])
  })

  it('ranks a match in the title over one in the text, and answers the summary with a snippet', async () => {
    const { owner, store } = await world('search-rank')
    await page(store, owner, {
      slug: 'in-text',
      title: 'Other things',
      // Three times in the text, against once in the title: only the weights put the title first.
      text: 'A word about passkeys, passkeys and passkeys.',
    })
    await page(store, owner, { slug: 'in-title', title: 'Passkeys', text: 'Nothing else.' })

    const hits = await store.searchEntries(owner.site, { text: 'passkeys', limit: 10 })

    expect(slugs(hits)).toEqual(['in-title', 'in-text'])
    expect(hits[1]?.snippet).toBe(
      'Other things A word about [passkeys], [passkeys] and [passkeys].  read more',
    )
    expect(hits[1]?.entry.entry.status).toBe('published')
    expect((hits[0]?.score ?? 0) > (hits[1]?.score ?? 0)).toBe(true)
  })

  it('narrows to a collection and a locale, and keeps to the limit', async () => {
    const { owner, store } = await world('search-narrow')
    await page(store, owner, { slug: 'a', title: 'Tide', text: 'One.' })
    await page(store, owner, { slug: 'b', title: 'Tide', text: 'Two.', locale: 'es' })
    await page(store, owner, { slug: 'c', title: 'Tide', text: 'Three.', collection: 'docs' })

    const search = (query: { collection?: string; locale?: string; limit?: number }) =>
      store.searchEntries(owner.site, { text: 'tide', limit: 10, ...query }).then(slugs)

    expect((await search({})).sort()).toEqual(['a', 'b', 'c'])
    expect(await search({ collection: 'docs' })).toEqual(['c'])
    expect((await search({ locale: 'en' })).sort()).toEqual(['a', 'c'])
    expect(await search({ limit: 1 })).toHaveLength(1)
  })

  it('takes FTS5 syntax as words, and answers nothing for a query with none', async () => {
    const { owner, store } = await world('search-syntax')
    await page(store, owner, { slug: 'near', title: 'Near the sea', text: 'Plain.' })

    const syntax = await store.searchEntries(owner.site, {
      text: 'near AND "sea" OR (*',
      limit: 10,
    })
    const nothing = await store.searchEntries(owner.site, { text: '"*" ()', limit: 10 })

    expect(slugs(syntax)).toEqual([])
    expect(nothing).toEqual([])
    expect(slugs(await store.searchEntries(owner.site, { text: 'near: sea!', limit: 10 }))).toEqual(
      ['near'],
    )
  })
})

describe('ftsQuery', () => {
  it('quotes each word, and drops what is not a word', () => {
    expect(ftsQuery('near AND "sea" OR (*')).toBe('"near" "AND" "sea" "OR"')
    expect(ftsQuery('migración, rápida')).toBe('"migración" "rápida"')
    expect(ftsQuery('  "*" () ')).toBe('')
  })
})
