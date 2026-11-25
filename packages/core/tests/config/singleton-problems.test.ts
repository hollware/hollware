import { describe, expect, it } from 'vite-plus/test'

import { resolveConfig } from '../../src/config/resolve.ts'
import type { ConfigProblem } from '../../src/config/config-error.ts'
import { collectionWith, configWith, problemsOf, siteOf } from './support.ts'

const HOME = 'sites.demo.collections.home'
const FIXED_FIX =
  'Write the one path of its entry in this locale, without :slug, such as "/" or "/en/".'

function homeConfig(overrides: Record<string, unknown>): Record<string, unknown> {
  return configWith({
    collections: {
      blog: collectionWith(),
      home: collectionWith({ singleton: true, ...overrides }),
    },
  })
}

interface Case {
  readonly name: string
  readonly config: unknown
  readonly problems: readonly ConfigProblem[]
}

const cases: readonly Case[] = [
  {
    name: 'a singleton route with :slug',
    config: homeConfig({ routes: { es: '/inicio/:slug/', en: '/en/' } }),
    problems: [
      {
        path: `${HOME}.routes.es`,
        message:
          '"/inicio/:slug/" has :slug, but a singleton has one entry per locale and no slug in its path',
        fix: FIXED_FIX,
      },
    ],
  },
  {
    name: 'a singleton route that does not start with a slash',
    config: homeConfig({ routes: { es: 'inicio/' } }),
    problems: [
      {
        path: `${HOME}.routes.es`,
        message: '"inicio/" does not start with "/"',
        fix: 'Write the path from the root of the site, such as "/" or "/en/".',
      },
    ],
  },
  {
    name: 'a singleton route that is a number',
    config: homeConfig({ routes: { es: 5 } }),
    problems: [
      {
        path: `${HOME}.routes.es`,
        message: 'is 5; it must be a path such as "/"',
        fix: FIXED_FIX,
      },
    ],
  },
  {
    name: 'singleton routes that are a string',
    config: homeConfig({ routes: '/' }),
    problems: [
      {
        path: `${HOME}.routes`,
        message: 'is "/"; it must be an object with one fixed path per locale',
        fix: 'Give the fixed path of its entry per locale, such as routes: { es: "/", en: "/en/" }, or remove routes for an entry with no page.',
      },
    ],
  },
  {
    name: 'a singleton route for a locale the site does not have',
    config: homeConfig({ routes: { fr: '/fr/' } }),
    problems: [
      {
        path: `${HOME}.routes.fr`,
        message: 'is a route for "fr", which is not a locale of the site (es, en)',
        fix: 'Remove it, or add "fr" to the locales of the site.',
      },
    ],
  },
  {
    name: 'two singletons on the same fixed path',
    config: configWith({
      collections: {
        home: collectionWith({ singleton: true, routes: { es: '/', en: '/en/' } }),
        landing: collectionWith({ singleton: true, routes: { es: '/', en: '/en/landing/' } }),
      },
    }),
    problems: [
      {
        path: 'sites.demo.collections.landing.routes.es',
        message: '"/" is the same pattern as the route at sites.demo.collections.home.routes.es',
        fix: 'Give every route of the site its own path: internal links are matched against them.',
      },
    ],
  },
  {
    name: 'singleton that is not a boolean',
    config: homeConfig({ singleton: 'yes', routes: { es: '/blog/:slug/x/', en: '/x/:slug/' } }),
    problems: [
      {
        path: `${HOME}.singleton`,
        message: 'is "yes"; it must be true or false',
        fix: 'Set singleton: true for a collection of one entry per locale, or remove it.',
      },
    ],
  },
  {
    name: 'a singleton that nests its entries',
    config: homeConfig({ routes: { es: '/' }, nesting: { maxDepth: 2 } }),
    problems: [
      {
        path: `${HOME}.nesting`,
        message: 'nests entries, but a singleton holds one entry per locale',
        fix: 'Remove nesting, or remove singleton for a collection of many entries.',
      },
    ],
  },
]

describe('a config with problems in a singleton', () => {
  it.each(cases)('reports $name', ({ config, problems }) => {
    expect(problemsOf(config)).toEqual(problems)
  })
})

describe('a singleton collection', () => {
  it('takes fixed routes, in the order of the locales, and is a singleton', () => {
    const site = siteOf(resolveConfig(homeConfig({ routes: { en: '/en/', es: '/' } })), 'demo')

    expect(site.collections.get('home')?.routes).toStrictEqual({ es: '/', en: '/en/' })
    expect(site.collections.get('home')?.singleton).toBe(true)
    expect(site.collections.get('blog')?.singleton).toBe(false)
  })

  it('may have no routes at all, or a route in some locales only', () => {
    const none = siteOf(resolveConfig(homeConfig({ routes: undefined })), 'demo')
    const some = siteOf(resolveConfig(homeConfig({ routes: { en: '/en/' } })), 'demo')

    expect(none.collections.get('home')?.routes).toStrictEqual({})
    expect(some.collections.get('home')?.routes).toStrictEqual({ en: '/en/' })
  })
})
