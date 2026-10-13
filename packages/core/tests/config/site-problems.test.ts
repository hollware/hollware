import { describe, expect, it } from 'vite-plus/test'

import type { ConfigProblem } from '../../src/config/config-error.ts'
import { collectionWith, configWith, problemsOf, siteWith } from './support.ts'

// Fails when: resolveConfig stops reporting, with its path, its message and its fix, that the
// config is no object, that it has no site, or not exactly one (zero, two, three), that a site is
// no object or its key breaks the site key rule (lowercase letters and digits joined by single
// hyphens, 1 to 64 characters), that its locales are missing, empty, not language tags or
// repeated, that its defaultLocale is not one of them, that it has no collection, that a
// collection is no object or its name breaks the rule (letters, digits, hyphens, a letter first,
// at most 63 characters), or that a style guide is no string; when a default locale that is
// listed but is no language tag is reported as missing from the locales; or when the problems of a
// site come out in another order than locales, defaultLocale, collections, styleGuide.

const CONFIG_FIX = 'Export the result of defineConfig({ sites: { … } }) from hollware.config.ts.'
const SITE_FIX =
  'Declare one site: sites: { "my-site": { locales: ["en"], defaultLocale: "en", collections: { … } } }.'
const SITE_KEY_FIX =
  'Use lowercase letters and digits joined by single hyphens, from 1 to 64 characters, such as "my-site".'
const LOCALE_FIX =
  'Write a language, then a region if you need one: "es", "en" or "pt-BR" (lowercase language, uppercase region).'
const COLLECTIONS_FIX =
  'Declare at least one: collections: { blog: defineCollection({ schema, routes }) }.'
const COLLECTION_NAME_FIX =
  'Use lowercase letters, digits and hyphens, starting with a letter, at most 63 characters, such as "blog".'
const STYLE_GUIDE_FIX = 'Write the guidance as a Markdown string, or remove it.'

interface Case {
  readonly name: string
  readonly config: unknown
  readonly problems: readonly ConfigProblem[]
}

const long = 'a'.repeat(64)
const tooLong = 'a'.repeat(65)
const withKey = (key: string) => ({ sites: { [key]: siteWith() } })

const cases: readonly Case[] = [
  {
    name: 'a config that is missing',
    config: undefined,
    problems: [{ path: 'config', message: 'is missing; it must be an object', fix: CONFIG_FIX }],
  },
  {
    name: 'a config that is null',
    config: null,
    problems: [{ path: 'config', message: 'is null; it must be an object', fix: CONFIG_FIX }],
  },
  {
    name: 'a config that is an array',
    config: [configWith()],
    problems: [{ path: 'config', message: 'is an array; it must be an object', fix: CONFIG_FIX }],
  },
  {
    name: 'a config without sites',
    config: {},
    problems: [
      {
        path: 'sites',
        message: 'is missing; it must be an object that maps the site key to the site',
        fix: SITE_FIX,
      },
    ],
  },
  {
    name: 'sites that is a string',
    config: { sites: 'demo' },
    problems: [
      {
        path: 'sites',
        message: 'is "demo"; it must be an object that maps the site key to the site',
        fix: SITE_FIX,
      },
    ],
  },
  {
    name: 'no site',
    config: { sites: {} },
    problems: [
      {
        path: 'sites',
        message: 'has no site, and v0.1 serves exactly one site per deployment',
        fix: SITE_FIX,
      },
    ],
  },
  {
    name: 'two sites',
    config: { sites: { alpha: siteWith(), beta: siteWith() } },
    problems: [
      {
        path: 'sites',
        message: 'has 2 sites ("alpha", "beta"), and v0.1 serves exactly one site per deployment',
        fix: 'Keep exactly one site in sites.',
      },
    ],
  },
  {
    name: 'three sites',
    config: { sites: { alpha: siteWith(), beta: siteWith(), gamma: siteWith() } },
    problems: [
      {
        path: 'sites',
        message:
          'has 3 sites ("alpha", "beta", "gamma"), and v0.1 serves exactly one site per deployment',
        fix: 'Keep exactly one site in sites.',
      },
    ],
  },
  {
    name: 'a site that is a string',
    config: { sites: { demo: 'blog' } },
    problems: [
      {
        path: 'sites.demo',
        message: 'is "blog"; it must be a site',
        fix: 'Declare it as { locales: ["en"], defaultLocale: "en", collections: { … } }.',
      },
    ],
  },
  {
    name: 'a site key with a capital letter',
    config: withKey('Demo'),
    problems: [
      { path: 'sites.Demo', message: '"Demo" is not a valid site key', fix: SITE_KEY_FIX },
    ],
  },
  {
    name: 'a site key with an underscore',
    config: withKey('my_site'),
    problems: [
      { path: 'sites.my_site', message: '"my_site" is not a valid site key', fix: SITE_KEY_FIX },
    ],
  },
  {
    name: 'a site key that ends with a hyphen',
    config: withKey('demo-'),
    problems: [
      { path: 'sites.demo-', message: '"demo-" is not a valid site key', fix: SITE_KEY_FIX },
    ],
  },
  {
    name: 'a site key with two hyphens in a row',
    config: withKey('my--site'),
    problems: [
      { path: 'sites.my--site', message: '"my--site" is not a valid site key', fix: SITE_KEY_FIX },
    ],
  },
  {
    name: 'a site key that is a hyphen',
    config: withKey('-'),
    problems: [{ path: 'sites.-', message: '"-" is not a valid site key', fix: SITE_KEY_FIX }],
  },
  {
    name: 'a site key that starts with a hyphen',
    config: withKey('-demo'),
    problems: [
      { path: 'sites.-demo', message: '"-demo" is not a valid site key', fix: SITE_KEY_FIX },
    ],
  },
  {
    name: 'a site key with a space',
    config: withKey('my site'),
    problems: [
      { path: 'sites["my site"]', message: '"my site" is not a valid site key', fix: SITE_KEY_FIX },
    ],
  },
  {
    name: 'a site key with an accent',
    config: withKey('démo'),
    problems: [
      { path: 'sites["démo"]', message: '"démo" is not a valid site key', fix: SITE_KEY_FIX },
    ],
  },
  {
    name: 'an empty site key',
    config: withKey(''),
    problems: [{ path: 'sites[""]', message: '"" is not a valid site key', fix: SITE_KEY_FIX }],
  },
  {
    name: 'a site key of 65 characters',
    config: withKey(tooLong),
    problems: [
      {
        path: `sites.${tooLong}`,
        message: `"${tooLong}" is not a valid site key`,
        fix: SITE_KEY_FIX,
      },
    ],
  },
  {
    name: 'locales that are missing',
    config: configWith({ locales: undefined }),
    problems: [
      {
        path: 'sites.demo.locales',
        message: 'is missing; it must be an array of language tags',
        fix: 'List the languages of the site, such as ["es", "en"].',
      },
    ],
  },
  {
    name: 'locales that is a string',
    config: configWith({ locales: 'es' }),
    problems: [
      {
        path: 'sites.demo.locales',
        message: 'is "es"; it must be an array of language tags',
        fix: 'List the languages of the site, such as ["es", "en"].',
      },
    ],
  },
  {
    name: 'locales that is empty',
    config: configWith({ locales: [] }),
    problems: [
      {
        path: 'sites.demo.locales',
        message: 'is empty',
        fix: 'List at least one language tag, such as ["en"].',
      },
    ],
  },
  {
    name: 'a locale in capitals',
    config: configWith({ locales: ['es', 'EN'] }),
    problems: [
      { path: 'sites.demo.locales[1]', message: '"EN" is not a language tag', fix: LOCALE_FIX },
    ],
  },
  {
    name: 'a locale with an underscore',
    config: configWith({ locales: ['es', 'en_US'] }),
    problems: [
      { path: 'sites.demo.locales[1]', message: '"en_US" is not a language tag', fix: LOCALE_FIX },
    ],
  },
  {
    name: 'a locale with a lowercase region',
    config: configWith({ locales: ['es', 'pt-br'] }),
    problems: [
      { path: 'sites.demo.locales[1]', message: '"pt-br" is not a language tag', fix: LOCALE_FIX },
    ],
  },
  {
    name: 'a locale that is a word',
    config: configWith({ locales: ['es', 'english'] }),
    problems: [
      {
        path: 'sites.demo.locales[1]',
        message: '"english" is not a language tag',
        fix: LOCALE_FIX,
      },
    ],
  },
  {
    name: 'a locale of one letter',
    config: configWith({ locales: ['es', 'e'] }),
    problems: [
      { path: 'sites.demo.locales[1]', message: '"e" is not a language tag', fix: LOCALE_FIX },
    ],
  },
  {
    name: 'an empty locale',
    config: configWith({ locales: ['es', ''] }),
    problems: [
      { path: 'sites.demo.locales[1]', message: '"" is not a language tag', fix: LOCALE_FIX },
    ],
  },
  {
    name: 'a locale that is a number',
    config: configWith({ locales: ['es', 5] }),
    problems: [
      {
        path: 'sites.demo.locales[1]',
        message: 'is 5; it must be a language tag',
        fix: LOCALE_FIX,
      },
    ],
  },
  {
    name: 'a locale that is listed twice',
    config: configWith({ locales: ['es', 'en', 'es'] }),
    problems: [
      {
        path: 'sites.demo.locales[2]',
        message: '"es" is already listed at sites.demo.locales[0]',
        fix: 'List each locale once.',
      },
    ],
  },
  {
    name: 'a locale that is listed twice, so the routes are not checked against the locales',
    config: configWith({ locales: ['es', 'es'] }),
    problems: [
      {
        path: 'sites.demo.locales[1]',
        message: '"es" is already listed at sites.demo.locales[0]',
        fix: 'List each locale once.',
      },
    ],
  },
  {
    name: 'a default locale that is missing',
    config: configWith({ defaultLocale: undefined }),
    problems: [
      {
        path: 'sites.demo.defaultLocale',
        message: 'is missing; it must be one of the locales',
        fix: 'Set it to the main language of the site, one of its locales.',
      },
    ],
  },
  {
    name: 'a default locale that is a number',
    config: configWith({ defaultLocale: 5 }),
    problems: [
      {
        path: 'sites.demo.defaultLocale',
        message: 'is 5; it must be one of the locales',
        fix: 'Set it to the main language of the site, one of its locales.',
      },
    ],
  },
  {
    name: 'a default locale that is not one of the locales',
    config: configWith({ defaultLocale: 'fr' }),
    problems: [
      {
        path: 'sites.demo.defaultLocale',
        message: 'is "fr", which is not one of the locales ("es", "en")',
        fix: 'Set it to one of "es", "en", or add "fr" to locales.',
      },
    ],
  },
  {
    name: 'collections that are missing',
    config: configWith({ collections: undefined }),
    problems: [
      {
        path: 'sites.demo.collections',
        message:
          'is missing; it must be an object that maps each collection name to its collection',
        fix: COLLECTIONS_FIX,
      },
    ],
  },
  {
    name: 'collections that is an array',
    config: configWith({ collections: [collectionWith()] }),
    problems: [
      {
        path: 'sites.demo.collections',
        message:
          'is an array; it must be an object that maps each collection name to its collection',
        fix: COLLECTIONS_FIX,
      },
    ],
  },
  {
    name: 'no collection',
    config: configWith({ collections: {} }),
    problems: [
      { path: 'sites.demo.collections', message: 'has no collection', fix: COLLECTIONS_FIX },
    ],
  },
  {
    name: 'a collection that is a number',
    config: configWith({ collections: { blog: 5 } }),
    problems: [
      {
        path: 'sites.demo.collections.blog',
        message: 'is 5; it must be a collection',
        fix: 'Declare it with defineCollection({ schema, routes, … }).',
      },
    ],
  },
  {
    name: 'a collection name with a capital letter',
    config: configWith({ collections: { Blog: collectionWith() } }),
    problems: [
      {
        path: 'sites.demo.collections.Blog',
        message: '"Blog" is not a valid collection name',
        fix: COLLECTION_NAME_FIX,
      },
    ],
  },
  {
    name: 'a collection name with a space',
    config: configWith({ collections: { 'my blog': collectionWith() } }),
    problems: [
      {
        path: 'sites.demo.collections["my blog"]',
        message: '"my blog" is not a valid collection name',
        fix: COLLECTION_NAME_FIX,
      },
    ],
  },
  {
    name: 'a collection name of 64 characters',
    config: configWith({ collections: { [long]: collectionWith() } }),
    problems: [
      {
        path: `sites.demo.collections.${long}`,
        message: `"${long}" is not a valid collection name`,
        fix: COLLECTION_NAME_FIX,
      },
    ],
  },
  {
    name: 'a site style guide that is a number',
    config: configWith({ styleGuide: 5 }),
    problems: [
      { path: 'sites.demo.styleGuide', message: 'is 5; it must be a string', fix: STYLE_GUIDE_FIX },
    ],
  },
  {
    name: 'a default locale that is listed but is no language tag, which is one problem',
    config: configWith({ locales: ['es', 'EN'], defaultLocale: 'EN' }),
    problems: [
      { path: 'sites.demo.locales[1]', message: '"EN" is not a language tag', fix: LOCALE_FIX },
    ],
  },
  {
    name: 'the problems of a site, in the order of its fields',
    config: configWith({
      styleGuide: 7,
      collections: {},
      defaultLocale: 'fr',
      locales: ['EN', 'es'],
    }),
    problems: [
      { path: 'sites.demo.locales[0]', message: '"EN" is not a language tag', fix: LOCALE_FIX },
      {
        path: 'sites.demo.defaultLocale',
        message: 'is "fr", which is not one of the locales ("EN", "es")',
        fix: 'Set it to one of "EN", "es", or add "fr" to locales.',
      },
      { path: 'sites.demo.collections', message: 'has no collection', fix: COLLECTIONS_FIX },
      { path: 'sites.demo.styleGuide', message: 'is 7; it must be a string', fix: STYLE_GUIDE_FIX },
    ],
  },
]

describe('a config with problems in its sites, locales and collections', () => {
  it.each(cases)('reports $name', ({ config, problems }) => {
    expect(problemsOf(config)).toEqual(problems)
  })
})
