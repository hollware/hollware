import type { HollwareReader } from '@hollware/client'
import { createApp, nextTick, ref, type App } from 'vue'
import { describe, expect, it } from 'vite-plus/test'

import {
  createHollwarePlugin,
  provideHollware,
  useHollwareEntries,
  useHollwareEntry,
  useHollwareNavigation,
} from '../src/index.ts'

const AT = '2026-10-01T00:00:00.000Z'

type Found = NonNullable<Awaited<ReturnType<HollwareReader['getEntry']>>['entry']>

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

function fakeReader(options: { missing?: string[]; failing?: string[] } = {}) {
  const calls: unknown[][] = []
  const waiting = new Map<string, () => void>()
  const gate = (key: string) =>
    new Promise<void>((resolve) => {
      waiting.set(key, resolve)
    })
  const reader: HollwareReader = {
    async getEntry(...args) {
      calls.push(['get', ...args])
      const slug = args[2]
      await gate(slug)
      if (options.failing?.includes(slug)) throw new Error(`no read of ${slug}`)
      if (options.missing?.includes(slug)) return { outcome: 'not_found' }
      return { outcome: 'ok', entry: entry(slug) }
    },
    async listEntries(...args) {
      calls.push(['list', ...args])
      const tag = args[2]?.tag ?? ''
      await gate(`list:${tag}`)
      return { outcome: 'ok', entries: [entry(`in-${tag}`)], nextCursor: null }
    },
    async getTranslations() {
      throw new Error('not read')
    },
    async getNavigation(...args) {
      calls.push(['navigation', ...args])
      const locale = args[2]?.locale ?? 'en'
      await gate(`navigation:${locale}`)
      return {
        outcome: 'ok',
        collection: args[1],
        locale,
        groups: [
          {
            name: 'start',
            entries: [
              { slug: `intro-${locale}`, title: 'Intro', description: null, path: null, order: 1 },
            ],
          },
        ],
      }
    },
    async describeSite() {
      throw new Error('not read')
    },
    async search() {
      throw new Error('not read')
    },
    async listRedirects() {
      throw new Error('not read')
    },
  }
  return {
    reader,
    calls,
    async release(key: string) {
      waiting.get(key)?.()
      await new Promise((resolve) => setTimeout(resolve, 0))
    },
  }
}

function appWith(reader: HollwareReader) {
  const app = createApp({})
  app.use(createHollwarePlugin({ site: 'my-site', reader }))
  return app
}

function inApp<T>(app: App, run: () => T): T {
  return app.runWithContext(run)
}

describe('useHollwareEntry', () => {
  it('reads the entry of the site and shows what a page sees of it', async () => {
    const fake = fakeReader()
    const state = inApp(appWith(fake.reader), () => useHollwareEntry('blog', 'en', 'hello'))

    expect(state.pending.value).toBe(true)
    expect(state.data.value).toBeUndefined()
    expect(fake.calls).toEqual([
      ['get', 'my-site', 'blog', 'hello', 'en', { formats: ['document'] }],
    ])

    await fake.release('hello')

    expect(state.pending.value).toBe(false)
    expect(state.error.value).toBeUndefined()
    expect(state.data.value).toEqual({
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
    })
  })

  it('answers undefined, with no error, for an entry that is not published', async () => {
    const fake = fakeReader({ missing: ['ghost'] })
    const state = inApp(appWith(fake.reader), () => useHollwareEntry('blog', 'en', 'ghost'))
    await fake.release('ghost')

    expect(state.pending.value).toBe(false)
    expect(state.data.value).toBeUndefined()
    expect(state.error.value).toBeUndefined()
  })

  it('shows the error of a failed read, and no data', async () => {
    const fake = fakeReader({ failing: ['bad'] })
    const slug = ref('hello')
    const state = inApp(appWith(fake.reader), () => useHollwareEntry('blog', 'en', slug))
    await fake.release('hello')
    expect(state.data.value?.slug).toBe('hello')

    slug.value = 'bad'
    await nextTick()
    await fake.release('bad')

    expect(state.error.value?.message).toBe('no read of bad')
    expect(state.data.value).toBeUndefined()
    expect(state.pending.value).toBe(false)
  })

  it('reads again when an argument changes, and keeps the old data while it loads', async () => {
    const fake = fakeReader()
    const slug = ref('one')
    const locale = ref('en')
    const state = inApp(appWith(fake.reader), () =>
      useHollwareEntry('blog', locale, () => slug.value),
    )
    await fake.release('one')

    slug.value = 'two'
    await nextTick()
    expect(state.pending.value).toBe(true)
    expect(state.data.value?.slug).toBe('one')
    await fake.release('two')
    expect(state.data.value?.slug).toBe('two')

    locale.value = 'es'
    await nextTick()
    expect(fake.calls.map((call) => [call[3], call[4]])).toEqual([
      ['one', 'en'],
      ['two', 'en'],
      ['two', 'es'],
    ])
  })

  it('drops the answer of a read that a newer one replaced', async () => {
    const fake = fakeReader()
    const slug = ref('slow')
    const state = inApp(appWith(fake.reader), () => useHollwareEntry('blog', 'en', slug))
    slug.value = 'fast'
    await nextTick()
    await fake.release('fast')
    await fake.release('slow')

    expect(state.data.value?.slug).toBe('fast')
    expect(state.pending.value).toBe(false)
  })

  it('names the mistake when nothing provides Hollware', () => {
    expect(() => inApp(createApp({}), () => useHollwareEntry('blog', 'en', 'x'))).toThrow(
      'add `app.use(createHollwarePlugin({ site, url, token }))`',
    )
  })

  it('is provided by provideHollware as by the plugin', async () => {
    const fake = fakeReader()
    const app = createApp({})
    provideHollware(app, { site: 'other', reader: fake.reader })
    inApp(app, () => useHollwareEntry('blog', 'en', 'x'))

    expect(fake.calls[0]?.[1]).toBe('other')
  })
})

describe('useHollwareEntries', () => {
  it('lists the published entries with the options, and reads again when they change', async () => {
    const fake = fakeReader()
    const options = ref({ tag: 'news', limit: 5 })
    const state = inApp(appWith(fake.reader), () => useHollwareEntries('blog', options))
    await fake.release('list:news')

    expect(fake.calls[0]).toEqual(['list', 'my-site', 'blog', { tag: 'news', limit: 5 }])
    expect(state.data.value?.entries.map((item) => item.slug)).toEqual(['in-news'])
    expect(state.data.value?.nextCursor).toBeNull()

    options.value = { tag: 'docs', limit: 5 }
    await nextTick()
    await fake.release('list:docs')
    expect(state.data.value?.entries.map((item) => item.slug)).toEqual(['in-docs'])
  })
})

describe('useHollwareNavigation', () => {
  it('reads the navigation of a collection in the locale, and again when it changes', async () => {
    const fake = fakeReader()
    const options = ref({ locale: 'en' })
    const state = inApp(appWith(fake.reader), () => useHollwareNavigation('docs', options))
    await fake.release('navigation:en')

    expect(fake.calls[0]).toEqual(['navigation', 'my-site', 'docs', { locale: 'en' }])
    expect(state.data.value).toEqual({
      collection: 'docs',
      locale: 'en',
      groups: [
        {
          name: 'start',
          entries: [{ slug: 'intro-en', title: 'Intro', description: null, path: null, order: 1 }],
        },
      ],
    })

    options.value = { locale: 'es' }
    await nextTick()
    await fake.release('navigation:es')
    expect(state.data.value?.groups[0]?.entries[0]?.slug).toBe('intro-es')
  })
})
