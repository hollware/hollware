import { describe, expect, it } from 'vite-plus/test'

import { classifyLink, compileRoutes, matchRoute } from '../../src/markdown/routes.ts'

const routes = compileRoutes(
  {
    help: { en: '/help/:slug/', es: '/es/ayuda/:slug/' },
    blog: { en: '/blog/:slug/' },
    talks: { en: '/talks/:slug/slides/' },
  },
  { help: 3, talks: 2 },
)

describe('a site path, matched against routes of nested collections', () => {
  it('names the entry by the last slug of a path as deep as the collection allows', () => {
    expect(matchRoute('/help/billing/payments/refunds/', routes)).toEqual({
      collection: 'help',
      locale: 'en',
      slug: 'refunds',
      slugPath: 'billing/payments/refunds',
    })
    expect(matchRoute('/es/ayuda/facturacion/', routes)).toEqual({
      collection: 'help',
      locale: 'es',
      slug: 'facturacion',
      slugPath: 'facturacion',
    })
  })

  it('matches nothing deeper than the depth of the collection', () => {
    expect(matchRoute('/help/a/b/c/d/', routes)).toBeUndefined()
  })

  it('keeps a flat collection to one slug', () => {
    expect(matchRoute('/blog/2026/hello/', routes)).toBeUndefined()
    expect(matchRoute('/blog/hello/', routes)?.slug).toBe('hello')
  })

  it('matches the segments of the route after the slugs', () => {
    expect(matchRoute('/talks/edge/caching/slides/', routes)).toEqual({
      collection: 'talks',
      locale: 'en',
      slug: 'caching',
      slugPath: 'edge/caching',
    })
    expect(matchRoute('/talks/edge/caching/', routes)).toBeUndefined()
  })

  it('refuses an empty slug in the middle of a path', () => {
    expect(matchRoute('/help/billing//refunds/', routes)).toBeUndefined()
  })

  it('makes a nested path an internal link to its last slug', () => {
    expect(classifyLink('/help/billing/refunds/#steps', routes)).toEqual({
      kind: 'internal',
      target: { collection: 'help', locale: 'en', slug: 'refunds' },
    })
  })
})
