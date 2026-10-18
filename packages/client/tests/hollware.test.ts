import { describe, expect, it } from 'vite-plus/test'

import { createHollware, hollwareBinding, type HollwareReader } from '../src/index.ts'

// Fails when: getEntry stops reading the Comark document, or stops passing the preview token of
// the request's cookie (or of `options.preview`, which wins) to the reader, or marks an answer a
// preview that was not read with one, or lets the verdict, the revision or the last publication
// of an entry reach the page, or answers an entry that is not found as anything but `undefined`;
// or listEntries stops passing the site, the collection and its filters through, or lets a field
// beyond a summary reach the page; or getTranslations stops answering `{ locale, slug }` pairs;
// or search stops passing the site, the query and its options, or lets more than a summary of an
// entry reach the page, or describeSite stops reading the site of the reader; or a reader given
// as a function is called once, at import time, instead of on each read; or
// something that is no service binding passes for one.

type Found = NonNullable<Awaited<ReturnType<HollwareReader['getEntry']>>['entry']>
const AT = '2026-10-01T00:00:00.000Z'
const TOKEN = 'hw_prv_AAAA.BBBB'

function entry(slug: string): Found {
  return {
    id: 'ent_01J9ZQ3X5V7K2M4N6P8R0T1W3Y',
    collection: 'blog',
    locale: 'en',
    slug,
    translationGroup: 'g1',
    status: 'published',
    version: 3,
    frontmatter: { title: slug },
    tags: ['a'],
    hasUnpublishedChanges: false,
    publishedAt: AT,
    scheduledAt: null,
    deletedAt: null,
    updatedAt: AT,
    revision: 'rev_01J9ZQ3X5V7K2M4N6P8R0T1W3Y',
    unpublishAt: null,
    verdict: { ok: true, phase: 'publish', errors: [], warnings: [], contractsHash: 'h' },
    lastPublication: null,
    document: { nodes: [['p', {}, slug]], frontmatter: {}, meta: {} },
  }
}

type Described = Awaited<ReturnType<HollwareReader['describeSite']>>['site']
// A site as describe_site answers it, with no collection.
const SITE: Described = {
  key: 's',
  locales: ['en'],
  defaultLocale: 'en',
  url: null,
  styleGuide: null,
  collections: [],
}

function fakeReader(missing: readonly string[] = []) {
  const calls: unknown[][] = []
  const reader: HollwareReader = {
    async getEntry(...args) {
      calls.push(['get', ...args])
      if (missing.includes(args[2])) return { outcome: 'not_found' }
      return { outcome: 'ok', entry: entry(args[2]) }
    },
    async listEntries(...args) {
      calls.push(['list', ...args])
      return { outcome: 'ok', entries: [entry('one')], nextCursor: 'c2' }
    },
    async getTranslations(...args) {
      calls.push(['translations', ...args])
      return { outcome: 'ok', entries: [entry('uno'), { ...entry('one'), locale: 'es' }] }
    },
    async describeSite(...args) {
      calls.push(['describe', ...args])
      return { outcome: 'ok', site: SITE }
    },
    async search(...args) {
      calls.push(['search', ...args])
      return {
        outcome: 'ok',
        mode: 'fulltext',
        results: [{ entry: entry('one'), snippet: 'the [edge]', score: 2.5 }],
      }
    },
  }
  return { reader, calls }
}

describe('createHollware', () => {
  it('searches the site, and sends the page no more of each entry than a summary', async () => {
    const { reader, calls } = fakeReader()
    const hollware = createHollware({ site: 's', reader })

    const found = await hollware.search('edge', { locale: 'en', limit: 5 })
    const described = await hollware.describeSite()

    expect(calls).toEqual([
      ['search', 's', 'edge', { locale: 'en', limit: 5 }],
      ['describe', 's'],
    ])
    expect(found.mode).toBe('fulltext')
    expect(found.results.map((result) => [result.snippet, result.score])).toEqual([
      ['the [edge]', 2.5],
    ])
    expect(Object.keys(found.results[0]?.entry ?? {})).not.toContain('verdict')
    expect(described).toBe(SITE)
  })

  it('reads the document of an entry in its locale, and sends the page no more than it shows', async () => {
    const { reader, calls } = fakeReader()

    const answer = await createHollware({ site: 's', reader }).getEntry('blog', 'en', 'hello')

    expect(calls).toEqual([['get', 's', 'blog', 'hello', 'en', { formats: ['document'] }]])
    expect(answer).toEqual({
      preview: false,
      entry: {
        id: 'ent_01J9ZQ3X5V7K2M4N6P8R0T1W3Y',
        collection: 'blog',
        locale: 'en',
        slug: 'hello',
        translationGroup: 'g1',
        frontmatter: { title: 'hello' },
        tags: ['a'],
        publishedAt: AT,
        updatedAt: AT,
        document: { nodes: [['p', {}, 'hello']], frontmatter: {}, meta: {} },
      },
    })
  })

  it('answers undefined for an entry that is not found', async () => {
    const { reader } = fakeReader(['gone'])

    expect(
      await createHollware({ site: 's', reader }).getEntry('blog', 'en', 'gone'),
    ).toBeUndefined()
  })

  it('reads with the preview token of the request cookie, and says it is a preview', async () => {
    const { reader, calls } = fakeReader()
    const request = new Request('https://site.test/blog/draft', {
      headers: { cookie: `x=1; hollware_preview=${TOKEN}` },
    })

    const answer = await createHollware({ site: 's', reader }).getEntry('blog', 'en', 'draft', {
      request,
    })

    expect(calls).toEqual([
      ['get', 's', 'blog', 'draft', 'en', { formats: ['document'], preview: TOKEN }],
    ])
    expect(answer?.preview).toBe(true)
  })

  it('ignores a cookie that is not shaped like a token, and lets an explicit token win', async () => {
    const { reader, calls } = fakeReader()
    const hollware = createHollware({ site: 's', reader })
    const bad = new Request('https://site.test/', { headers: { cookie: 'hollware_preview=nope' } })
    const good = new Request('https://site.test/', {
      headers: { cookie: `hollware_preview=${TOKEN}` },
    })

    const plain = await hollware.getEntry('blog', 'en', 'a', { request: bad, preview: 'nope' })
    await hollware.getEntry('blog', 'en', 'b', { request: good, preview: 'hw_prv_CC.DD' })

    expect(plain?.preview).toBe(false)
    expect(calls).toEqual([
      ['get', 's', 'blog', 'a', 'en', { formats: ['document'] }],
      ['get', 's', 'blog', 'b', 'en', { formats: ['document'], preview: 'hw_prv_CC.DD' }],
    ])
  })

  it('lists a collection with its filters, a summary per entry, and the cursor', async () => {
    const { reader, calls } = fakeReader()

    const page = await createHollware({ site: 's', reader }).listEntries('blog', {
      locale: 'en',
      tag: 'a',
      limit: 5,
      cursor: 'c1',
    })

    expect(calls).toEqual([
      ['list', 's', 'blog', { locale: 'en', tag: 'a', limit: 5, cursor: 'c1' }],
    ])
    expect(page.nextCursor).toBe('c2')
    expect(page.entries).toEqual([
      {
        id: 'ent_01J9ZQ3X5V7K2M4N6P8R0T1W3Y',
        collection: 'blog',
        locale: 'en',
        slug: 'one',
        translationGroup: 'g1',
        frontmatter: { title: 'one' },
        tags: ['a'],
        publishedAt: AT,
        updatedAt: AT,
      },
    ])
  })

  it('answers the locale and slug of each entry of a translation group', async () => {
    const { reader, calls } = fakeReader()

    const found = await createHollware({ site: 's', reader }).getTranslations('blog', 'g1')

    expect(calls).toEqual([['translations', 's', 'blog', 'g1']])
    expect(found).toEqual([
      { locale: 'en', slug: 'uno' },
      { locale: 'es', slug: 'one' },
    ])
  })

  it('resolves a reader given as a function on each read, not when it is made', async () => {
    const { reader } = fakeReader()
    let resolved = 0
    const hollware = createHollware({
      site: 's',
      reader: () => {
        resolved += 1
        return reader
      },
    })
    expect(resolved).toBe(0)

    await hollware.getEntry('blog', 'en', 'a')
    await hollware.listEntries('blog')

    expect(resolved).toBe(2)
  })
})

describe('hollwareBinding', () => {
  it('passes a reader through, and names the missing binding otherwise', () => {
    const { reader } = fakeReader()

    expect(hollwareBinding(reader)).toBe(reader)
    expect(() => hollwareBinding(undefined)).toThrow(
      'Hollware: the Worker has no service binding HOLLWARE to the Hollware entrypoint: add it to services in wrangler.jsonc.',
    )
    expect(() => hollwareBinding({}, 'CMS')).toThrow('no service binding CMS')
  })
})
