import { describe, expect, it } from 'vite-plus/test'

import { createApi } from '../app/lib/api.ts'
import type { Auth } from '../app/lib/auth.ts'
import { humanName, kindOf, openSingleton, type SingletonCollection } from '../app/lib/singleton.ts'

const auth: Auth = {
  signIn: async () => {},
  switchSite: async () => {},
  complete: async () => '/',
  token: async () => 'access-1',
  forget: () => {},
  signOut: async () => {},
}

interface Listed {
  readonly locale: string
  readonly slug: string
  readonly translationGroup: string | null
}

interface Stored extends Listed {
  readonly trashed?: boolean
}

function world(stored: readonly Stored[]) {
  const sent: Array<{ path: string; body: unknown }> = []
  const api = createApi({
    fetch: async (input, init) => {
      const path = typeof input === 'string' ? input : input instanceof URL ? input.pathname : ''
      const body: { locale?: string; trashed?: boolean } = JSON.parse(
        typeof init?.body === 'string' ? init.body : '{}',
      )
      sent.push({ path, body })
      const entries = stored
        .filter((entry) => body.locale === undefined || entry.locale === body.locale)
        .filter((entry) => (entry.trashed ?? false) === (body.trashed ?? false))
        .map((entry) => ({
          locale: entry.locale,
          slug: entry.slug,
          translationGroup: entry.translationGroup,
          collection: 'footer',
          frontmatter: {},
        }))
      return Response.json({ entries: entries.slice(0, 1), nextCursor: null })
    },
    auth,
    here: () => '/admin/entries',
  })
  return { api, sent }
}

const FOOTER: SingletonCollection = {
  name: 'footer',
  schema: {
    type: 'object',
    properties: { group: { type: 'string' }, columns: { type: 'array' } },
    required: ['columns'],
  },
  routes: {},
  translationGroupField: 'group',
  singleton: true,
}

describe('a singleton collection', () => {
  it('is a list unless it is a singleton, and settings when it has no route', () => {
    expect(kindOf({ routes: { en: '/blog/:slug/' } })).toBe('list')
    expect(kindOf({ singleton: false, routes: {} })).toBe('list')
    expect(kindOf({ singleton: true, routes: {} })).toBe('settings')
    expect(kindOf({ singleton: true, routes: { es: '/', en: '/en/' } })).toBe('page')
  })

  it('opens its entry in the locale when it has one', async () => {
    const { api, sent } = world([{ locale: 'en', slug: 'site-footer', translationGroup: 'g1' }])

    expect(await openSingleton(api, FOOTER, 'en')).toEqual({
      kind: 'open',
      to: '/entries/footer/en/site-footer',
    })
    expect(sent.map((call) => call.path)).toEqual(['/v1/ops/list_entries'])
  })

  it('writes nothing when the locale has no entry: it asks for one, in the group of the others', async () => {
    const { api, sent } = world([{ locale: 'es', slug: 'footer', translationGroup: 'g1' }])

    expect(await openSingleton(api, FOOTER, 'en')).toEqual({
      kind: 'new',
      query: { collection: 'footer', locale: 'en', group: 'g1' },
    })
    expect(sent.map((call) => call.path)).not.toContain('/v1/ops/create_draft')
  })

  it('asks for an entry with no group when no locale has one', async () => {
    expect(await openSingleton(world([]).api, FOOTER, 'en')).toEqual({
      kind: 'new',
      query: { collection: 'footer', locale: 'en' },
    })
  })

  it('shows the trash when its entry in the locale is there', async () => {
    const { api } = world([{ locale: 'en', slug: 'footer', translationGroup: null, trashed: true }])

    expect(await openSingleton(api, FOOTER, 'en')).toEqual({ kind: 'trash' })
  })

  it('names its title after the collection', () => {
    expect(humanName('home-page')).toBe('Home page')
  })
})
