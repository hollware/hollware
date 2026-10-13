import { describe, expect, it } from 'vite-plus/test'

import { blogPath, entryPath, isLocale, matchRoute } from '../src/routes.ts'

// Fails when: src/routes.ts stops mapping addresses to what the blog collection of Hollware's
// hollware.config.ts routes (`/blog/:slug/` for Spanish, `/en/blog/:slug/` for English): an index
// or an entry of either locale; the redirect of an address that lacks its trailing slash; or the
// refusal of an address that cannot be an entry (a slug that Hollware's `slug` input would refuse,
// or another path), which the site answers with a 404 before it calls Hollware.

describe('matchRoute', () => {
  it.each([
    ['/blog/', { kind: 'index', locale: 'es' }],
    ['/en/blog/', { kind: 'index', locale: 'en' }],
    ['/blog/edge-caching/', { kind: 'entry', locale: 'es', slug: 'edge-caching' }],
    ['/en/blog/edge-caching/', { kind: 'entry', locale: 'en', slug: 'edge-caching' }],
    ['/blog/en/', { kind: 'entry', locale: 'es', slug: 'en' }],
    ['/en/blog/a1-b2/', { kind: 'entry', locale: 'en', slug: 'a1-b2' }],
  ])('serves %s', (pathname, route) => {
    expect(matchRoute(pathname)).toEqual(route)
  })

  it.each([
    ['/blog', '/blog/'],
    ['/en/blog', '/en/blog/'],
    ['/blog/edge-caching', '/blog/edge-caching/'],
    ['/en/blog/edge-caching', '/en/blog/edge-caching/'],
  ])('redirects %s to %s', (pathname, to) => {
    expect(matchRoute(pathname)).toEqual({ kind: 'redirect', to })
  })

  it.each([
    '/',
    '/en/',
    '/blogs/',
    '/blog//',
    '/en/blog//',
    '/blog/Edge/',
    '/blog/a_b/',
    '/blog/a.b/',
    '/blog/-a/',
    '/blog/a-/',
    '/blog/a--b/',
    '/blog/a/b/',
    `/blog/${'a'.repeat(201)}/`,
  ])('serves nothing at %s', (pathname) => {
    expect(matchRoute(pathname)).toBeNull()
  })

  it('serves a slug of 200 characters, the longest Hollware takes', () => {
    const slug = 'a'.repeat(200)

    expect(matchRoute(`/blog/${slug}/`)).toEqual({ kind: 'entry', locale: 'es', slug })
  })
})

describe('the paths of the blog', () => {
  it('end in a slash, under the prefix of their locale', () => {
    expect(blogPath('es')).toBe('/blog/')
    expect(blogPath('en')).toBe('/en/blog/')
    expect(entryPath('es', 'edge-caching')).toBe('/blog/edge-caching/')
    expect(entryPath('en', 'edge-caching')).toBe('/en/blog/edge-caching/')
  })

  it('know the two locales of the site, and no other', () => {
    expect(['es', 'en', 'fr', '', 'ES'].map(isLocale)).toEqual([true, true, false, false, false])
  })
})
