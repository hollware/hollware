import { describe, expect, it } from 'vite-plus/test'

import { createApi } from '../app/lib/api.ts'
import type { Auth } from '../app/lib/auth.ts'
import { kindOf, openSingleton, type SingletonCollection } from '../app/lib/singleton.ts'

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

function world(stored: readonly Listed[], created: 'saved' | 'in_trash' | 'refused' = 'saved') {
  const sent: Array<{ path: string; body: unknown }> = []
  const api = createApi({
    fetch: async (input, init) => {
      const path = typeof input === 'string' ? input : input instanceof URL ? input.pathname : ''
      const body: unknown = JSON.parse(typeof init?.body === 'string' ? init.body : '{}')
      sent.push({ path, body })
      if (path === '/v1/ops/list_entries') {
        const locale =
          typeof body === 'object' && body !== null && 'locale' in body ? body.locale : undefined
        const entries = stored
          .filter((entry) => locale === undefined || entry.locale === locale)
          .map((entry) => ({ ...entry, collection: 'footer', frontmatter: {} }))
        return Response.json({ entries: entries.slice(0, 1), nextCursor: null })
      }
      return Response.json({ outcome: created })
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

  it('opens its entry in the locale when it has one, and creates nothing', async () => {
    const { api, sent } = world([{ locale: 'en', slug: 'site-footer', translationGroup: 'g1' }])

    expect(await openSingleton(api, FOOTER, 'en', '2026-11-25')).toEqual({
      kind: 'open',
      to: '/entries/footer/en/site-footer',
    })
    expect(sent.map((call) => call.path)).toEqual(['/v1/ops/list_entries'])
  })

  it('creates its entry, named after the collection, in the group of its other translations', async () => {
    const { api, sent } = world([{ locale: 'es', slug: 'footer', translationGroup: 'g1' }])

    expect(await openSingleton(api, FOOTER, 'en', '2026-11-25')).toEqual({
      kind: 'open',
      to: '/entries/footer/en/footer',
    })
    expect(sent.at(-1)).toEqual({
      path: '/v1/ops/create_draft',
      body: {
        collection: 'footer',
        locale: 'en',
        slug: 'footer',
        markdown: '---\ncolumns: []\ngroup: "g1"\n---\n\n',
      },
    })
  })

  it('gives its title a name from the collection when the schema has a title', async () => {
    const { api, sent } = world([])
    const home = {
      ...FOOTER,
      name: 'home-page',
      schema: { type: 'object', properties: { title: { type: 'string' } } },
      routes: { en: '/' },
    }

    await openSingleton(api, home, 'en', '2026-11-25')

    expect(sent.at(-1)?.body).toEqual({
      collection: 'home-page',
      locale: 'en',
      slug: 'home-page',
      markdown: '---\ntitle: "Home page"\n---\n\n',
    })
  })

  it('shows the trash when its entry is there, and the form when the server refuses it', async () => {
    expect(await openSingleton(world([], 'in_trash').api, FOOTER, 'en', '2026-11-25')).toEqual({
      kind: 'trash',
    })
    expect(
      await openSingleton(
        world([{ locale: 'es', slug: 'footer', translationGroup: 'g1' }], 'refused').api,
        FOOTER,
        'en',
        '2026-11-25',
      ),
    ).toEqual({ kind: 'new', query: { collection: 'footer', locale: 'en', group: 'g1' } })
  })
})
