import { describe, expect, it } from 'vite-plus/test'

import {
  agent,
  BINDING,
  blogPost,
  contextFor,
  NO_ENTRY,
  tenantOf,
  UNTOUCHED,
  type Tenant,
} from './support.ts'

const CLOCK = { now: () => new Date('2026-10-13T10:00:00.000Z') }

function callerOf(tenant: Tenant) {
  return agent(contextFor(tenant, UNTOUCHED, { clock: CLOCK }))
}

const tenant = tenantOf(
  'names-site',
  'usr_01JAB3XQ8ZK4M6N2P5R7S9T0VA',
  'tok_01JAB3XQ8ZK4M6N2P5R7S9T0VB',
)
const caller = callerOf(tenant)

const MARKDOWN = blogPost()
const BROKEN = '---\ntitle: [an unclosed list\n---\n'

type Caller = ReturnType<typeof callerOf>

const WITH_COLLECTION: readonly (readonly [
  string,
  (caller: Caller, collection: string) => Promise<unknown>,
])[] = [
  ['list_entries', (c, collection) => c.listEntries({ collection })],
  ['get_entry', (c, collection) => c.getEntry({ collection, locale: 'en', slug: 'a-post' })],
  [
    'get_translations',
    (c, collection) => c.getTranslations({ collection, translationGroup: 'a-post' }),
  ],
  [
    'create_draft',
    (c, collection) =>
      c.createDraft({ collection, locale: 'en', slug: 'a-post', markdown: BROKEN }),
  ],
  [
    'validate',
    (c, collection) => c.validate({ collection, locale: 'en', slug: 'a-post', markdown: BROKEN }),
  ],
]

const WITH_LOCALE: readonly (readonly [
  string,
  (caller: Caller, locale: string) => Promise<unknown>,
])[] = [
  ['list_entries', (c, locale) => c.listEntries({ collection: 'blog', locale })],
  ['get_entry', (c, locale) => c.getEntry({ collection: 'blog', locale, slug: 'a-post' })],
  [
    'create_draft',
    (c, locale) => c.createDraft({ collection: 'blog', locale, slug: 'a-post', markdown: BROKEN }),
  ],
  [
    'validate',
    (c, locale) => c.validate({ collection: 'blog', locale, slug: 'a-post', markdown: BROKEN }),
  ],
]

describe('the collection and the locale of a call', () => {
  it.each(WITH_COLLECTION)(
    'refuses a collection the site does not have in %s, and lists the ones it has, before it touches the store or the Markdown',
    async (_operation, call) => {
      await expect(call(caller, 'blogs')).rejects.toMatchObject({
        name: 'HollwareError',
        code: 'unknown_collection',
        message: 'The site has no collection "blogs".',
        fix: 'Use one of its collections: blog, notes. describe_site lists them with their schemas.',
      })
    },
  )

  it.each(WITH_LOCALE)(
    'refuses a locale the site does not have in %s, and lists the ones it has, before it touches the store or the Markdown',
    async (_operation, call) => {
      await expect(call(caller, 'fr')).rejects.toMatchObject({
        name: 'HollwareError',
        code: 'unknown_locale',
        message: 'The site has no locale "fr".',
        fix: 'Use one of its locales: es, en.',
      })
    },
  )

  it('checks the collection before the locale', async () => {
    await expect(
      caller.createDraft({ collection: 'blogs', locale: 'fr', slug: 'a-post', markdown: MARKDOWN }),
    ).rejects.toMatchObject({ code: 'unknown_collection' })
    await expect(
      caller.getEntry({ collection: 'blogs', locale: 'fr', slug: 'a-post' }),
    ).rejects.toMatchObject({ code: 'unknown_collection' })
  })

  it('cuts a long name before it repeats it, and keeps it on one line', async () => {
    await expect(caller.listEntries({ collection: `x${'y'.repeat(99)}` })).rejects.toMatchObject({
      message: `The site has no collection "x${'y'.repeat(59)}…".`,
    })
    await expect(caller.listEntries({ collection: 'blog', locale: 'f\nr' })).rejects.toMatchObject({
      message: 'The site has no locale "f\\nr".',
    })
  })

  it('does not cut a name inside a character that takes two code units', async () => {
    const name = `${'x'.repeat(59)}${String.fromCodePoint(0x1f600)}${'y'.repeat(10)}`

    await expect(caller.listEntries({ collection: name })).rejects.toMatchObject({
      message: `The site has no collection "${'x'.repeat(59)}…".`,
    })
  })

  it('takes a listing with no locale, which asks the store', async () => {
    await expect(caller.listEntries({ collection: 'blog' })).rejects.toThrow(
      'the store was touched: listEntries',
    )
  })

  it('refuses get_translations for a collection with no translations, and says where to look', async () => {
    await expect(
      caller.getTranslations({ collection: 'notes', translationGroup: 'a-note' }),
    ).rejects.toMatchObject({
      name: 'HollwareError',
      code: 'invalid_input',
      message:
        'The collection "notes" has no translations, so its entries belong to no translation group.',
      fix: 'describe_site shows translationGroupField as null for this collection: read its entries with get_entry or list_entries instead.',
    })
  })
})

describe('a write from a principal that is not a token', () => {
  const reader = agent(
    contextFor(tenant, UNTOUCHED, { clock: CLOCK, principal: BINDING, requestId: 'req_names_1' }),
  )

  it.each([
    [
      'create_draft',
      () =>
        reader.createDraft({
          collection: 'blog',
          locale: 'en',
          slug: 'a-post',
          markdown: MARKDOWN,
        }),
    ],
    ['update_draft', () => reader.updateDraft({ id: NO_ENTRY, version: 1, markdown: MARKDOWN })],
    ['publish', () => reader.publish({ id: NO_ENTRY, version: 1 })],
    ['unpublish', () => reader.unpublish({ id: NO_ENTRY })],
  ])(
    'is an internal error in %s, whose message says nothing about the cause, before the store is touched',
    async (_operation, call) => {
      await expect(call()).rejects.toMatchObject({
        name: 'HollwareError',
        code: 'internal',
        message: 'The operation failed on the server.',
        fix: 'Try again. If it keeps failing, give the site operator this request id: req_names_1.',
        cause: {
          message: 'A write was routed for a principal of kind binding; only a person writes.',
        },
      })
    },
  )
})
