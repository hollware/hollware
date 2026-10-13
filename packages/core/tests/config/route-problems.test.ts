import { describe, expect, it } from 'vite-plus/test'

import type { ConfigProblem } from '../../src/config/config-error.ts'
import { BLOG, blogConfig, collectionWith, configWith, problemsOf } from './support.ts'

// Fails when: resolveConfig stops reporting, with its path, its message and its fix, that the
// routes of a collection are missing or no object, miss a locale of the site, have one it does not
// have, hold something that is no string, a route that does not start with "/" or does not have
// :slug exactly once (`:slugs` is no :slug), or two routes of the site, in any collection and any
// locale, that are the same pattern (a trailing slash does not tell them apart); when a route
// that is already wrong, or for a locale the site does not have, is also taken for a duplicate;
// when the routes are checked against locales that are not valid; or when the problems of the
// routes of a site come out in another order than the order of the config.

const ROUTES_FIX =
  'Add one route per locale, such as routes: { es: "/blog/:slug/", en: "/en/blog/:slug/" }.'
const PATH_FIX = 'Write the path from the root of the site, such as "/blog/:slug/".'
const SLUG_FIX = 'Use :slug exactly once, where the slug of the entry goes, such as "/blog/:slug/".'
const DUPLICATE_FIX =
  'Give every route of the site its own path: internal links are matched against them.'
const LOCALE_FIX =
  'Write a language, then a region if you need one: "es", "en" or "pt-BR" (lowercase language, uppercase region).'

interface Case {
  readonly name: string
  readonly config: unknown
  readonly problems: readonly ConfigProblem[]
}

const cases: readonly Case[] = [
  {
    name: 'routes that are missing',
    config: blogConfig({ routes: undefined }),
    problems: [
      {
        path: `${BLOG}.routes`,
        message: 'is missing; it must be an object with one path per locale',
        fix: ROUTES_FIX,
      },
    ],
  },
  {
    name: 'routes that is a string',
    config: blogConfig({ routes: '/blog/:slug/' }),
    problems: [
      {
        path: `${BLOG}.routes`,
        message: 'is "/blog/:slug/"; it must be an object with one path per locale',
        fix: ROUTES_FIX,
      },
    ],
  },
  {
    name: 'a route for one locale only',
    config: blogConfig({ routes: { es: '/blog/:slug/' } }),
    problems: [
      {
        path: `${BLOG}.routes`,
        message: 'has no route for the locale "en"',
        fix: 'Add routes.en, a path such as "/en/blog/:slug/".',
      },
    ],
  },
  {
    name: 'routes without any locale',
    config: blogConfig({ routes: {} }),
    problems: [
      {
        path: `${BLOG}.routes`,
        message: 'has no route for the locale "es"',
        fix: 'Add routes.es, a path such as "/es/blog/:slug/".',
      },
      {
        path: `${BLOG}.routes`,
        message: 'has no route for the locale "en"',
        fix: 'Add routes.en, a path such as "/en/blog/:slug/".',
      },
    ],
  },
  {
    name: 'a route for a locale the site does not have',
    config: blogConfig({
      routes: { es: '/blog/:slug/', en: '/en/blog/:slug/', fr: '/fr/blog/:slug/' },
    }),
    problems: [
      {
        path: `${BLOG}.routes.fr`,
        message: 'is a route for "fr", which is not a locale of the site (es, en)',
        fix: 'Remove it, or add "fr" to the locales of the site.',
      },
    ],
  },
  {
    name: 'a route that is a number',
    config: blogConfig({ routes: { es: 5, en: '/en/blog/:slug/' } }),
    problems: [
      {
        path: `${BLOG}.routes.es`,
        message: 'is 5; it must be a path such as "/blog/:slug/"',
        fix: ROUTES_FIX,
      },
    ],
  },
  {
    name: 'a route that is there without a path, which is not also a route that is missing',
    config: blogConfig({ routes: { es: undefined, en: '/en/blog/:slug/' } }),
    problems: [
      {
        path: `${BLOG}.routes.es`,
        message: 'is missing; it must be a path such as "/blog/:slug/"',
        fix: ROUTES_FIX,
      },
    ],
  },
  {
    name: 'a route that does not start with a slash',
    config: blogConfig({ routes: { es: 'blog/:slug/', en: '/en/blog/:slug/' } }),
    problems: [
      {
        path: `${BLOG}.routes.es`,
        message: '"blog/:slug/" does not start with "/"',
        fix: PATH_FIX,
      },
    ],
  },
  {
    name: 'a route without :slug',
    config: blogConfig({ routes: { es: '/blog/', en: '/en/blog/:slug/' } }),
    problems: [{ path: `${BLOG}.routes.es`, message: '"/blog/" has no :slug', fix: SLUG_FIX }],
  },
  {
    name: 'a route with :slugs, which is another placeholder',
    config: blogConfig({ routes: { es: '/blog/:slugs/', en: '/en/blog/:slug/' } }),
    problems: [
      { path: `${BLOG}.routes.es`, message: '"/blog/:slugs/" has no :slug', fix: SLUG_FIX },
    ],
  },
  {
    name: 'a route with :slug_id, which is another placeholder',
    config: blogConfig({ routes: { es: '/blog/:slug_id/', en: '/en/blog/:slug/' } }),
    problems: [
      { path: `${BLOG}.routes.es`, message: '"/blog/:slug_id/" has no :slug', fix: SLUG_FIX },
    ],
  },
  {
    name: 'a route with :slug twice',
    config: blogConfig({ routes: { es: '/blog/:slug/:slug/', en: '/en/blog/:slug/' } }),
    problems: [
      {
        path: `${BLOG}.routes.es`,
        message: '"/blog/:slug/:slug/" has :slug 2 times',
        fix: SLUG_FIX,
      },
    ],
  },
  {
    name: 'a route with :slug three times',
    config: blogConfig({ routes: { es: '/:slug-:slug.:slug', en: '/en/blog/:slug/' } }),
    problems: [
      {
        path: `${BLOG}.routes.es`,
        message: '"/:slug-:slug.:slug" has :slug 3 times',
        fix: SLUG_FIX,
      },
    ],
  },
  {
    name: 'a route that breaks both rules',
    config: blogConfig({ routes: { es: 'blog/', en: '/en/blog/:slug/' } }),
    problems: [
      { path: `${BLOG}.routes.es`, message: '"blog/" does not start with "/"', fix: PATH_FIX },
      { path: `${BLOG}.routes.es`, message: '"blog/" has no :slug', fix: SLUG_FIX },
    ],
  },
  {
    name: 'the same route for two locales of a collection',
    config: blogConfig({ routes: { es: '/blog/:slug/', en: '/blog/:slug/' } }),
    problems: [
      {
        path: `${BLOG}.routes.en`,
        message:
          '"/blog/:slug/" is the same pattern as the route at sites.demo.collections.blog.routes.es',
        fix: DUPLICATE_FIX,
      },
    ],
  },
  {
    name: 'two routes that differ by a trailing slash',
    config: blogConfig({ routes: { es: '/blog/:slug', en: '/blog/:slug/' } }),
    problems: [
      {
        path: `${BLOG}.routes.en`,
        message:
          '"/blog/:slug/" is the same pattern as the route at sites.demo.collections.blog.routes.es',
        fix: DUPLICATE_FIX,
      },
    ],
  },
  {
    name: 'the same route in two collections',
    config: configWith({
      collections: {
        blog: collectionWith(),
        news: collectionWith({ routes: { es: '/noticias/:slug/', en: '/en/blog/:slug/' } }),
      },
    }),
    problems: [
      {
        path: 'sites.demo.collections.news.routes.en',
        message:
          '"/en/blog/:slug/" is the same pattern as the route at sites.demo.collections.blog.routes.en',
        fix: DUPLICATE_FIX,
      },
    ],
  },
  {
    name: 'a route that three collections share, which is two problems with the first owner',
    config: configWith({
      collections: {
        blog: collectionWith(),
        news: collectionWith({ routes: { es: '/noticias/:slug/', en: '/en/blog/:slug/' } }),
        docs: collectionWith({ routes: { es: '/blog/:slug', en: '/en/docs/:slug/' } }),
      },
    }),
    problems: [
      {
        path: 'sites.demo.collections.news.routes.en',
        message:
          '"/en/blog/:slug/" is the same pattern as the route at sites.demo.collections.blog.routes.en',
        fix: DUPLICATE_FIX,
      },
      {
        path: 'sites.demo.collections.docs.routes.es',
        message:
          '"/blog/:slug" is the same pattern as the route at sites.demo.collections.blog.routes.es',
        fix: DUPLICATE_FIX,
      },
    ],
  },
  {
    name: 'routes that are wrong, which are not also taken for duplicates',
    config: blogConfig({ routes: { es: '/blog/', en: '/blog/' } }),
    problems: [
      { path: `${BLOG}.routes.es`, message: '"/blog/" has no :slug', fix: SLUG_FIX },
      { path: `${BLOG}.routes.en`, message: '"/blog/" has no :slug', fix: SLUG_FIX },
    ],
  },
  {
    name: 'a route for a locale the site does not have, which is not taken for a duplicate',
    config: blogConfig({
      routes: { es: '/blog/:slug/', en: '/en/blog/:slug/', fr: '/blog/:slug/' },
    }),
    problems: [
      {
        path: `${BLOG}.routes.fr`,
        message: 'is a route for "fr", which is not a locale of the site (es, en)',
        fix: 'Remove it, or add "fr" to the locales of the site.',
      },
    ],
  },
  {
    name: 'a locale that is not valid, so the routes are not checked against the locales',
    config: configWith({ locales: ['es', 'EN'], collections: { blog: collectionWith() } }),
    problems: [
      { path: 'sites.demo.locales[1]', message: '"EN" is not a language tag', fix: LOCALE_FIX },
    ],
  },
  {
    name: 'routes that are wrong in every way, in the order of the config',
    config: configWith({
      collections: {
        blog: collectionWith({ routes: { en: '/en/blog/', fr: 5, es: 'blog/:slug/' } }),
        news: collectionWith({ routes: { es: '/blog/:slug', en: 'x' } }),
      },
    }),
    problems: [
      {
        path: 'sites.demo.collections.blog.routes.en',
        message: '"/en/blog/" has no :slug',
        fix: SLUG_FIX,
      },
      {
        path: 'sites.demo.collections.blog.routes.fr',
        message: 'is a route for "fr", which is not a locale of the site (es, en)',
        fix: 'Remove it, or add "fr" to the locales of the site.',
      },
      {
        path: 'sites.demo.collections.blog.routes.fr',
        message: 'is 5; it must be a path such as "/blog/:slug/"',
        fix: ROUTES_FIX,
      },
      {
        path: 'sites.demo.collections.blog.routes.es',
        message: '"blog/:slug/" does not start with "/"',
        fix: PATH_FIX,
      },
      {
        path: 'sites.demo.collections.news.routes.en',
        message: '"x" does not start with "/"',
        fix: PATH_FIX,
      },
      { path: 'sites.demo.collections.news.routes.en', message: '"x" has no :slug', fix: SLUG_FIX },
    ],
  },
]

describe('a config with problems in its routes', () => {
  it.each(cases)('reports $name', ({ config, problems }) => {
    expect(problemsOf(config)).toEqual(problems)
  })
})
