import { describe, expect, it } from 'vite-plus/test'

import { createApi } from '../app/lib/api.ts'
import type { Auth } from '../app/lib/auth.ts'
import { sourceWhenTranslated, translationsOf } from '../app/lib/translations.ts'

describe('the source of a translation that fell behind', () => {
  const source = [
    { id: 'c', createdAt: '2026-10-30T12:00:00.000Z' },
    { id: 'b', createdAt: '2026-10-29T12:00:00.000Z' },
    { id: 'a', createdAt: '2026-10-28T12:00:00.000Z' },
  ]

  it('is read as it was when the translation was saved, not as it is now', () => {
    expect(sourceWhenTranslated(source, '2026-10-29T18:00:00.000Z')?.id).toBe('b')
    expect(sourceWhenTranslated(source, '2026-10-29T12:00:00.000Z')?.id).toBe('b')
    expect(sourceWhenTranslated(source, '2026-10-27T12:00:00.000Z')).toBeUndefined()
  })
})

interface Stored {
  readonly locale: string
  readonly slug: string
  readonly translationGroup: string | null
}

function world(stored: readonly Stored[]) {
  const asked: string[] = []
  const api = createApi({
    fetch: async (input, init) => {
      const path = typeof input === 'string' ? input : input instanceof URL ? input.pathname : ''
      const body: { locale?: string; slug?: string; translationGroup?: string } = JSON.parse(
        typeof init?.body === 'string' ? init.body : '{}',
      )
      const operation = path.slice('/v1/ops/'.length)
      asked.push(operation)
      const summary = (entry: Stored) => ({
        id: `${entry.locale}-${entry.slug}`,
        collection: 'pages',
        locale: entry.locale,
        slug: entry.slug,
        slugPath: entry.slug,
        translationGroup: entry.translationGroup,
        frontmatter: {},
      })
      if (operation === 'get_entry') {
        const found = stored.find((e) => e.locale === body.locale && e.slug === body.slug)
        return found === undefined
          ? Response.json({ code: 'not_found', message: 'none', fix: 'none' }, { status: 404 })
          : Response.json({ outcome: 'ok', entry: summary(found) })
      }
      const entries = stored
        .filter(
          (e) => operation !== 'get_translations' || e.translationGroup === body.translationGroup,
        )
        .map(summary)
      return Response.json({ outcome: 'ok', entries, nextCursor: null })
    },
    auth,
    here: () => '/admin/entries',
  })
  return { api, asked }
}

const auth: Auth = {
  signIn: async () => {},
  switchSite: async () => {},
  complete: async () => '/',
  token: async () => 'access-1',
  forget: () => {},
  signOut: async () => {},
}

describe('the translations an entry links to', () => {
  const stored: Stored[] = [
    { locale: 'en', slug: 'features', translationGroup: null },
    { locale: 'es', slug: 'features', translationGroup: null },
    { locale: 'es', slug: 'pricing', translationGroup: null },
    { locale: 'en', slug: 'launch', translationGroup: 'launch' },
    { locale: 'es', slug: 'lanzamiento', translationGroup: 'launch' },
  ]

  it('are the entries of its translation group, when its collection groups them', async () => {
    const { api, asked } = world(stored)
    const found = await translationsOf(
      api,
      { collection: 'pages', locale: 'en', slugPath: 'launch', translationGroup: 'launch' },
      { translationGroupField: 'translationGroup' },
      ['en', 'es'],
    )
    expect(found.map((e) => `${e.locale}/${e.slug}`)).toEqual(['en/launch', 'es/lanzamiento'])
    expect(asked).toEqual(['get_translations'])
  })

  it('are the entries with its slug in the other locales, when its collection has no group', async () => {
    const { api } = world(stored)
    const found = await translationsOf(
      api,
      { collection: 'pages', locale: 'en', slugPath: 'features', translationGroup: null },
      { translationGroupField: null },
      ['en', 'es', 'pt'],
    )
    expect(found.map((e) => `${e.locale}/${e.slug}`)).toEqual(['en/features', 'es/features'])
  })

  it('are the one entry of each locale, in a singleton', async () => {
    const { api, asked } = world([
      { locale: 'es', slug: 'inicio', translationGroup: null },
      { locale: 'en', slug: 'home', translationGroup: null },
    ])
    const found = await translationsOf(
      api,
      { collection: 'home', locale: 'en', slugPath: 'home', translationGroup: null },
      { singleton: true, translationGroupField: null },
      ['en', 'es'],
    )
    expect(found.map((e) => `${e.locale}/${e.slug}`)).toEqual(['en/home', 'es/inicio'])
    expect(asked).toEqual(['list_entries'])
  })
})
