import { HollwareClientError, type HollwareReader } from '@hollware/client'
import { describe, expect, it } from 'vite-plus/test'

import {
  createSource,
  hollwareBinding,
  hollwareLiveLoader,
  hollwareTranslations,
  loadInto,
  type LoadContext,
} from '../src/index.ts'

// Fails when: the loaders of src/index.ts stop reading only the collection and locale they are
// given, or give an entry an id other than its slug, data other than its frontmatter, or a
// `rendered.html` other than the HTML Hollware made (source.ts `get`); or a listing stops following
// the cursor, stops at `limit`, or reads one page too many (source.ts `list`); or a live loader
// answers anything but `undefined` for an entry that is not published, or throws instead of
// handing Astro an `error` (`asError`); or a build-time load keeps an entry that was unpublished
// (`store.delete`), or stops validating the frontmatter with the schema of the collection
// (`parseData`); or a service binding that is not one passes for a reader, or a binding given as a function is read once, at import time, instead of on
// each request.

type Listed = Awaited<ReturnType<HollwareReader['listEntries']>>['entries'][number]
type Found = NonNullable<Awaited<ReturnType<HollwareReader['getEntry']>>['entry']>
type Published = Found & { html: string }

const AT = '2026-10-01T00:00:00.000Z'

function post(slug: string, title: string): Published {
  return {
    id: 'ent_01J9ZQ3X5V7K2M4N6P8R0T1W3Y',
    collection: 'blog',
    locale: 'en',
    slug,
    translationGroup: null,
    status: 'published',
    version: 1,
    frontmatter: { title },
    tags: [],
    hasUnpublishedChanges: false,
    publishedAt: AT,
    scheduledAt: null,
    deletedAt: null,
    updatedAt: AT,
    revision: 'rev_01J9ZQ3X5V7K2M4N6P8R0T1W3Y',
    verdict: { ok: true, phase: 'publish', errors: [], warnings: [], contractsHash: 'h' },
    lastPublication: null,
    html: `<h1>${title}</h1>`,
  }
}

/** A reader of published posts, two to a page: the calls it gets are in `calls`. */
function fakeReader(published: readonly Published[]) {
  const calls: string[] = []
  const reader: HollwareReader = {
    async listEntries(site, collection, options) {
      calls.push(
        `list ${site} ${collection} ${options?.locale} ${options?.tag} ${options?.limit} ${options?.cursor}`,
      )
      const start = options?.cursor === undefined ? 0 : Number(options.cursor)
      const entries: Listed[] = published.slice(start, start + 2)
      return {
        outcome: 'ok',
        entries,
        nextCursor: start + 2 < published.length ? String(start + 2) : null,
      }
    },
    async getEntry(site, collection, slug, locale, options) {
      calls.push(`get ${site} ${collection} ${locale} ${slug} ${options?.formats?.join(',')}`)
      const found = published.find((entry) => entry.slug === slug)
      return found === undefined ? { outcome: 'not_found' } : { outcome: 'ok', entry: found }
    },
    async getTranslations(site, collection, group) {
      calls.push(`translations ${site} ${collection} ${group}`)
      return {
        outcome: 'ok',
        entries: [
          { ...post('hello', 'Hello'), locale: 'en' },
          { ...post('hola', 'Hola'), locale: 'es' },
        ],
      }
    },
    async describeSite() {
      throw new Error('not read')
    },
    async search() {
      throw new Error('not read')
    },
  }
  return { reader, calls }
}

const POSTS = [post('hello', 'Hello'), post('second', 'Second'), post('third', 'Third')]

const base = { site: 'playground', collection: 'blog', locale: 'en' }

describe('hollwareLiveLoader', () => {
  it('gives an entry its slug as id, its frontmatter as data and the HTML of Hollware as rendered.html', async () => {
    const { reader, calls } = fakeReader(POSTS)
    const loader = hollwareLiveLoader({ ...base, reader })

    const entry = await loader.loadEntry({ collection: 'blog', filter: { id: 'hello' } })

    expect(entry).toEqual({
      id: 'hello',
      data: { title: 'Hello' },
      rendered: { html: '<h1>Hello</h1>' },
      cacheHint: { lastModified: new Date(AT) },
    })
    expect(calls).toEqual(['get playground blog en hello html'])
  })

  it('answers undefined for an entry that is not published', async () => {
    const { reader } = fakeReader(POSTS)
    const loader = hollwareLiveLoader({ ...base, reader })

    expect(await loader.loadEntry({ collection: 'blog', filter: { id: 'draft' } })).toBeUndefined()
  })

  it('lists the entries of the locale through every page, without their HTML', async () => {
    const { reader, calls } = fakeReader(POSTS)
    const loader = hollwareLiveLoader({ ...base, reader })

    const result = await loader.loadCollection({ collection: 'blog' })

    expect(result).toEqual({
      entries: [
        { id: 'hello', data: { title: 'Hello' }, cacheHint: { lastModified: new Date(AT) } },
        { id: 'second', data: { title: 'Second' }, cacheHint: { lastModified: new Date(AT) } },
        { id: 'third', data: { title: 'Third' }, cacheHint: { lastModified: new Date(AT) } },
      ],
    })
    expect(calls).toEqual([
      'list playground blog en undefined 100 undefined',
      'list playground blog en undefined 100 2',
    ])
  })

  it('stops at the limit and passes the tag', async () => {
    const { reader, calls } = fakeReader(POSTS)
    const loader = hollwareLiveLoader({ ...base, reader })

    const result = await loader.loadCollection({
      collection: 'blog',
      filter: { tag: 'agents', limit: 1 },
    })

    expect(result).toMatchObject({ entries: [{ id: 'hello' }, { id: 'second' }] })
    expect(calls).toEqual(['list playground blog en agents 1 undefined'])
  })

  it('hands Astro an error when Hollware refuses, instead of throwing', async () => {
    const { reader } = fakeReader(POSTS)
    const loader = hollwareLiveLoader({
      ...base,
      reader: {
        ...reader,
        getEntry: async () => {
          throw new HollwareClientError(401, 'unauthorized', 'The token is not valid.', null)
        },
      },
    })

    const result = await loader.loadEntry({ collection: 'blog', filter: { id: 'hello' } })

    expect(result).toMatchObject({
      error: { message: 'Hollware answered 401 (unauthorized): The token is not valid.' },
    })
  })

  it('takes its reader on each call: a binding exists only while a request runs', async () => {
    const { reader, calls } = fakeReader(POSTS)
    let available = false
    const loader = hollwareLiveLoader({
      ...base,
      reader: () => {
        if (!available) throw new Error('no binding yet')
        return reader
      },
    })
    available = true

    await loader.loadEntry({ collection: 'blog', filter: { id: 'hello' } })

    expect(calls).toEqual(['get playground blog en hello html'])
  })
})

describe('loadInto', () => {
  function fakeContext(initial: string[] = []) {
    const entries = new Map<
      string,
      { data: Record<string, unknown>; html: string; digest: string }
    >()
    const gone = new Set(initial)
    const validated: Array<Record<string, unknown>> = []
    const context: LoadContext = {
      store: {
        set: ({ id, data, rendered, digest }) => {
          entries.set(id, { data, html: rendered?.html ?? '', digest: String(digest) })
          return true
        },
        keys: () => [...entries.keys(), ...gone],
        delete: (id) => {
          gone.delete(id)
        },
      },
      parseData: async ({ data }) => {
        validated.push(data)
        return { ...data, parsed: true }
      },
      generateDigest: (value) => JSON.stringify(value),
      logger: { info: () => undefined },
    }
    return { entries, gone, validated, context }
  }

  it('stores each published entry with its HTML, validated, and drops what is no longer published', async () => {
    const { reader } = fakeReader(POSTS.slice(0, 2))
    const { entries, gone, validated, context } = fakeContext(['unpublished'])

    await loadInto(createSource({ ...base, reader }), context)

    expect([...entries.keys()]).toEqual(['hello', 'second'])
    expect(entries.get('hello')).toEqual({
      data: { title: 'Hello', parsed: true },
      html: '<h1>Hello</h1>',
      digest: '{"data":{"title":"Hello","parsed":true},"html":"<h1>Hello</h1>"}',
    })
    expect(validated).toEqual([{ title: 'Hello' }, { title: 'Second' }])
    expect([...gone]).toEqual([])
  })

  it('reads over HTTP with the read token when it has a URL instead of a reader', async () => {
    const requests: Array<{ url: string; authorization: string | null }> = []
    const source = createSource({
      ...base,
      url: 'https://cms.example.com/',
      token: 'hw_read_abc',
      fetch: async (request) => {
        requests.push({ url: request.url, authorization: request.headers.get('authorization') })
        const body = request.url.includes('/v1/blog/en/hello')
          ? { outcome: 'ok', entry: POSTS[0] }
          : { outcome: 'ok', entries: [POSTS[0]], nextCursor: null }
        return new Response(JSON.stringify(body), { status: 200 })
      },
    })
    const { entries, context } = fakeContext()

    await loadInto(source, context)

    expect([...entries.keys()]).toEqual(['hello'])
    expect(requests).toEqual([
      {
        url: 'https://cms.example.com/v1/blog?locale=en&limit=100',
        authorization: 'Bearer hw_read_abc',
      },
      {
        url: 'https://cms.example.com/v1/blog/en/hello?formats=html',
        authorization: 'Bearer hw_read_abc',
      },
    ])
  })
})

describe('hollwareTranslations', () => {
  it('gives the locale and slug of each entry of the group', async () => {
    const { reader, calls } = fakeReader(POSTS)

    const found = await hollwareTranslations({ ...base, reader }, 'greeting')

    expect(found).toEqual([
      { locale: 'en', slug: 'hello' },
      { locale: 'es', slug: 'hola' },
    ])
    expect(calls).toEqual(['translations playground blog greeting'])
  })
})

describe('hollwareBinding', () => {
  it('gives the binding back when it reads, and names the missing one when it does not', () => {
    const { reader } = fakeReader(POSTS)

    expect(hollwareBinding(reader)).toBe(reader)
    expect(() => hollwareBinding(undefined, 'CMS')).toThrow(
      'Hollware: the Worker has no service binding CMS to the Hollware entrypoint: add it to services in wrangler.jsonc.',
    )
  })
})
