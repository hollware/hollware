import { describe, expect, it } from 'vite-plus/test'
import * as z from 'zod'

import { ConfigError, type ConfigProblem } from '../../src/config/config-error.ts'
import { resolveConfig } from '../../src/config/resolve.ts'
import { BUILT_IN_CONTRACT_IDS, contracts } from '../../src/contracts/index.ts'
import {
  BLOG,
  blogConfig,
  collectionWith,
  configWith,
  problemsOf,
  siteOf,
  siteWith,
  thrownBy,
} from './support.ts'

// Fails when: resolveConfig stops reporting, with its path, its message and its fix, that the
// contracts of a collection are no array, that a contract is no object, that its id is not
// lowercase words joined by single hyphens, is the id of a built-in contract (each of the
// fourteen of BUILT_IN_CONTRACT_IDS) without being one that Hollware made, such as a plain object
// or a copy of `contracts.translationPair()`, or repeats the id of another contract of the
// collection (a reserved or invalid id is reported for what it is, not also as a repeat), that
// its severity is not error or warning, that its phases are no array, empty, hold something that
// is neither write nor publish or repeat one, that its description is empty or blank, or that it
// has no check function; that maxMarkdownBytes is not an integer from 1 to 786,432 (768 KiB); or
// that a style guide is no string; when the contracts that Hollware made (`contracts.*`) stop
// being let through, or let through twice; when a valid contract is not kept exactly as given;
// when a config of the wrong types makes resolveConfig throw anything
// but a ConfigError; or when the ConfigError stops carrying every problem as data and as one line
// of its message, `<path>: <message>. <fix>`, in the order they were found.

const CONTRACTS_FIX = 'Write it as [{ id, severity, description, check }, …].'
const CONTRACT_FIX = 'Write it as { id, severity, description, check }.'
const ID_FIX = 'Name the rule with lowercase words joined by hyphens.'
const ID_MUST = 'lowercase words joined by hyphens, such as "seo-title-length"'
const RESERVED_FIX =
  "Choose another id: schema, components, raw-html, unknown-component, disallowed-attribute, unsafe-url, translation-pair, internal-links-resolve, images-have-alt, size-limit, frontmatter-syntax, comark-parse, unique-slug, unique-translation belong to Hollware's built-in contracts, and the opt-in ones are listed as contracts.translationPair(), contracts.internalLinksResolve() and contracts.imagesHaveAlt()."
const DUPLICATE_FIX = 'Give every contract of the collection its own id.'
const SEVERITY_FIX =
  'Use "error" for a rule that blocks publishing and "warning" for one that publishing asks to acknowledge.'
const PHASES_FIX =
  'Use "write" (create_draft and update_draft), "publish" (validate and publish) or both, or remove phases to run in both.'
const DESCRIPTION_FIX = 'Describe the rule for the agent that has to follow it.'
const DESCRIPTION_MUST = 'a sentence that says what the rule asks for'
const CHECK_FIX =
  'Add check(context), which returns a list of problems, empty when the content passes.'
const CHECK_MUST = 'a function that returns the problems it finds'
const SIZE_FIX =
  'Set a size in bytes from 1 to 786432 (768 KiB), or remove it for the default of 524288 (512 KiB): a revision row is about 2.3 times the file and the store refuses rows over 1.9 MB, so a larger file could never be saved.'
const STYLE_GUIDE_FIX = 'Write the guidance as a Markdown string, or remove it.'
const LOCALE_FIX =
  'Write a language, then a region if you need one: "es", "en" or "pt-BR" (lowercase language, uppercase region).'

interface Case {
  readonly name: string
  readonly config: unknown
  readonly problems: readonly ConfigProblem[]
}

const check = () => []
const contract = (overrides: Record<string, unknown> = {}) => ({
  id: 'has-title',
  severity: 'error',
  description: 'A title that is not empty.',
  check,
  ...overrides,
})
const withContracts = (...contracts: unknown[]) => blogConfig({ contracts })
const at = (index: number, field = '') => `${BLOG}.contracts[${index}]${field}`

/** The problems of a contract that is only `{ id }`: no severity, no description, no check. */
const bareProblems = (index: number): ConfigProblem[] => [
  {
    path: at(index, '.severity'),
    message: 'is missing; it must be "error" or "warning"',
    fix: SEVERITY_FIX,
  },
  {
    path: at(index, '.description'),
    message: `is missing; it must be ${DESCRIPTION_MUST}`,
    fix: DESCRIPTION_FIX,
  },
  {
    path: at(index, '.check'),
    message: `is missing; it must be ${CHECK_MUST}`,
    fix: CHECK_FIX,
  },
]

const badIds = ['Has-Title', 'has_title', 'has title', 'has--title', '-has', 'has-', '1has', '']

const contractCases: readonly Case[] = [
  {
    name: 'contracts that is a number',
    config: blogConfig({ contracts: 5 }),
    problems: [
      {
        path: `${BLOG}.contracts`,
        message: 'is 5; it must be an array of contracts',
        fix: CONTRACTS_FIX,
      },
    ],
  },
  {
    name: 'contracts that is an object',
    config: blogConfig({ contracts: { id: 'has-title' } }),
    problems: [
      {
        path: `${BLOG}.contracts`,
        message: 'is an object; it must be an array of contracts',
        fix: CONTRACTS_FIX,
      },
    ],
  },
  {
    name: 'a contract that is a number',
    config: withContracts(5),
    problems: [{ path: at(0), message: 'is 5; it must be a contract', fix: CONTRACT_FIX }],
  },
  {
    name: 'a contract that is null',
    config: withContracts(contract(), null),
    problems: [{ path: at(1), message: 'is null; it must be a contract', fix: CONTRACT_FIX }],
  },
  {
    name: 'a contract that is an array',
    config: withContracts([contract()]),
    problems: [{ path: at(0), message: 'is an array; it must be a contract', fix: CONTRACT_FIX }],
  },
  {
    name: 'a contract without an id',
    config: withContracts(contract({ id: undefined })),
    problems: [{ path: at(0, '.id'), message: `is missing; it must be ${ID_MUST}`, fix: ID_FIX }],
  },
  {
    name: 'a contract whose id is a number',
    config: withContracts(contract({ id: 5 })),
    problems: [{ path: at(0, '.id'), message: `is 5; it must be ${ID_MUST}`, fix: ID_FIX }],
  },
  ...badIds.map((id): Case => ({
    name: `a contract whose id is ${JSON.stringify(id)}`,
    config: withContracts(contract({ id })),
    problems: [
      {
        path: at(0, '.id'),
        message: `is ${JSON.stringify(id)}; it must be ${ID_MUST}`,
        fix: ID_FIX,
      },
    ],
  })),
  ...BUILT_IN_CONTRACT_IDS.map((id): Case => ({
    name: `a plain contract with the built-in id ${id}`,
    config: withContracts(contract({ id })),
    problems: [
      {
        path: at(0, '.id'),
        message: `"${id}" is the id of a built-in contract`,
        fix: RESERVED_FIX,
      },
    ],
  })),
  {
    name: 'two contracts with the same id',
    config: withContracts(contract(), contract({ severity: 'warning' })),
    problems: [
      {
        path: at(1, '.id'),
        message: `"has-title" is already the id of the contract at ${at(0)}`,
        fix: DUPLICATE_FIX,
      },
    ],
  },
  {
    name: 'three contracts with the same id, which are two repeats of the first',
    config: withContracts(contract(), contract({ id: 'other' }), contract(), contract()),
    problems: [
      {
        path: at(2, '.id'),
        message: `"has-title" is already the id of the contract at ${at(0)}`,
        fix: DUPLICATE_FIX,
      },
      {
        path: at(3, '.id'),
        message: `"has-title" is already the id of the contract at ${at(0)}`,
        fix: DUPLICATE_FIX,
      },
    ],
  },
  {
    name: 'a built-in id used twice, which is two uses of a built-in id and no repeat',
    config: withContracts(contract({ id: 'schema' }), contract({ id: 'schema' })),
    problems: [
      {
        path: at(0, '.id'),
        message: '"schema" is the id of a built-in contract',
        fix: RESERVED_FIX,
      },
      {
        path: at(1, '.id'),
        message: '"schema" is the id of a built-in contract',
        fix: RESERVED_FIX,
      },
    ],
  },
  {
    name: 'a copy of a contract that Hollware made, which Hollware did not make',
    config: withContracts({ ...contracts.translationPair() }),
    problems: [
      {
        path: at(0, '.id'),
        message: '"translation-pair" is the id of a built-in contract',
        fix: RESERVED_FIX,
      },
    ],
  },
  {
    name: 'a custom contract with a built-in id, which is no contract that Hollware made',
    config: withContracts(
      contracts.custom({
        id: 'schema',
        severity: 'error',
        description: 'A rule that takes the id of the schema.',
        check: () => true,
        message: 'It fails.',
        fix: 'Pass it.',
      }),
    ),
    problems: [
      {
        path: at(0, '.id'),
        message: '"schema" is the id of a built-in contract',
        fix: RESERVED_FIX,
      },
    ],
  },
  {
    name: 'a plain contract next to the one that Hollware made with its id, which is only the plain one',
    config: withContracts(contracts.imagesHaveAlt(), contract({ id: 'images-have-alt' })),
    problems: [
      {
        path: at(1, '.id'),
        message: '"images-have-alt" is the id of a built-in contract',
        fix: RESERVED_FIX,
      },
    ],
  },
  {
    name: 'a contract that Hollware made, listed twice',
    config: withContracts(contracts.translationPair(), contracts.translationPair()),
    problems: [
      {
        path: at(1, '.id'),
        message: `"translation-pair" is already the id of the contract at ${at(0)}`,
        fix: DUPLICATE_FIX,
      },
    ],
  },
  {
    name: 'a built-in id on a contract that is not whole, which is the shape and then the id',
    config: withContracts({ id: 'schema' }),
    problems: [
      ...bareProblems(0),
      {
        path: at(0, '.id'),
        message: '"schema" is the id of a built-in contract',
        fix: RESERVED_FIX,
      },
    ],
  },
  {
    name: 'an id that another contract has, on a contract that is not whole',
    config: withContracts(contract(), { id: 'has-title' }),
    problems: [
      ...bareProblems(1),
      {
        path: at(1, '.id'),
        message: `"has-title" is already the id of the contract at ${at(0)}`,
        fix: DUPLICATE_FIX,
      },
    ],
  },
  {
    name: 'an invalid id used twice, which is two invalid ids and no repeat',
    config: withContracts(contract({ id: 'Bad' }), contract({ id: 'Bad' })),
    problems: [
      { path: at(0, '.id'), message: `is "Bad"; it must be ${ID_MUST}`, fix: ID_FIX },
      { path: at(1, '.id'), message: `is "Bad"; it must be ${ID_MUST}`, fix: ID_FIX },
    ],
  },
  {
    name: 'a contract without a severity',
    config: withContracts(contract({ severity: undefined })),
    problems: [
      {
        path: at(0, '.severity'),
        message: 'is missing; it must be "error" or "warning"',
        fix: SEVERITY_FIX,
      },
    ],
  },
  {
    name: 'a contract with the severity warn',
    config: withContracts(contract({ severity: 'warn' })),
    problems: [
      {
        path: at(0, '.severity'),
        message: 'is "warn"; it must be "error" or "warning"',
        fix: SEVERITY_FIX,
      },
    ],
  },
  {
    name: 'a contract whose phases are a string',
    config: withContracts(contract({ phases: 'write' })),
    problems: [
      {
        path: at(0, '.phases'),
        message: 'is "write"; it must be an array of "write" and "publish"',
        fix: PHASES_FIX,
      },
    ],
  },
  {
    name: 'a contract whose phases are empty, so it would never run',
    config: withContracts(contract({ phases: [] })),
    problems: [
      {
        path: at(0, '.phases'),
        message: 'is empty, so the contract would never run',
        fix: PHASES_FIX,
      },
    ],
  },
  {
    name: 'a contract with a phase that does not exist',
    config: withContracts(contract({ phases: ['write', 'draft', 7] })),
    problems: [
      {
        path: at(0, '.phases[1]'),
        message: 'is "draft"; it must be "write" or "publish"',
        fix: PHASES_FIX,
      },
      {
        path: at(0, '.phases[2]'),
        message: 'is 7; it must be "write" or "publish"',
        fix: PHASES_FIX,
      },
    ],
  },
  {
    name: 'a contract that names a phase twice',
    config: withContracts(contract({ phases: ['publish', 'write', 'publish'] })),
    problems: [{ path: at(0, '.phases[2]'), message: 'repeats "publish"', fix: PHASES_FIX }],
  },
  {
    name: 'a contract without a description',
    config: withContracts(contract({ description: undefined })),
    problems: [
      {
        path: at(0, '.description'),
        message: `is missing; it must be ${DESCRIPTION_MUST}`,
        fix: DESCRIPTION_FIX,
      },
    ],
  },
  {
    name: 'a contract with an empty description',
    config: withContracts(contract({ description: '' })),
    problems: [
      {
        path: at(0, '.description'),
        message: `is ""; it must be ${DESCRIPTION_MUST}`,
        fix: DESCRIPTION_FIX,
      },
    ],
  },
  {
    name: 'a contract with a blank description',
    config: withContracts(contract({ description: ' \n ' })),
    problems: [
      {
        path: at(0, '.description'),
        message: `is " \\n "; it must be ${DESCRIPTION_MUST}`,
        fix: DESCRIPTION_FIX,
      },
    ],
  },
  {
    name: 'a contract whose description is a number',
    config: withContracts(contract({ description: 5 })),
    problems: [
      {
        path: at(0, '.description'),
        message: `is 5; it must be ${DESCRIPTION_MUST}`,
        fix: DESCRIPTION_FIX,
      },
    ],
  },
  {
    name: 'a contract without a check',
    config: withContracts(contract({ check: undefined })),
    problems: [
      { path: at(0, '.check'), message: `is missing; it must be ${CHECK_MUST}`, fix: CHECK_FIX },
    ],
  },
  {
    name: 'a contract whose check is a string',
    config: withContracts(contract({ check: 'return []' })),
    problems: [
      {
        path: at(0, '.check'),
        message: `is "return []"; it must be ${CHECK_MUST}`,
        fix: CHECK_FIX,
      },
    ],
  },
  {
    name: 'a contract with every problem, in the order id, severity, phases, description, check',
    config: withContracts({ phases: [] }),
    problems: [
      { path: at(0, '.id'), message: `is missing; it must be ${ID_MUST}`, fix: ID_FIX },
      {
        path: at(0, '.severity'),
        message: 'is missing; it must be "error" or "warning"',
        fix: SEVERITY_FIX,
      },
      {
        path: at(0, '.phases'),
        message: 'is empty, so the contract would never run',
        fix: PHASES_FIX,
      },
      {
        path: at(0, '.description'),
        message: `is missing; it must be ${DESCRIPTION_MUST}`,
        fix: DESCRIPTION_FIX,
      },
      { path: at(0, '.check'), message: `is missing; it must be ${CHECK_MUST}`, fix: CHECK_FIX },
    ],
  },
  {
    name: 'contracts that are wrong around one that is right',
    config: withContracts(
      contract({ id: 'Bad' }),
      contract({ id: 'fine' }),
      contract({ check: 1 }),
    ),
    problems: [
      { path: at(0, '.id'), message: `is "Bad"; it must be ${ID_MUST}`, fix: ID_FIX },
      { path: at(2, '.check'), message: `is 1; it must be ${CHECK_MUST}`, fix: CHECK_FIX },
    ],
  },
]

/** A size that is wrong and how a message shows it. */
const wrongSizes: readonly (readonly [unknown, string])[] = [
  [0, '0'],
  [-5, '-5'],
  [1.5, '1.5'],
  [786_433, '786433'],
  [1_048_576, '1048576'],
  [Number.NaN, 'NaN'],
  [Number.POSITIVE_INFINITY, 'Infinity'],
  ['512', '"512"'],
  [null, 'null'],
  [true, 'true'],
  [[], 'an array'],
  [{}, 'an object'],
  [10n, '10'],
  [Symbol('size'), 'a symbol'],
]

const limitCases: readonly Case[] = [
  ...wrongSizes.map(([value, shown]): Case => ({
    name: `a size of ${shown}`,
    config: blogConfig({ maxMarkdownBytes: value }),
    problems: [
      {
        path: `${BLOG}.maxMarkdownBytes`,
        message: `is ${shown}; it must be an integer from 1 to 786432`,
        fix: SIZE_FIX,
      },
    ],
  })),
  {
    name: 'a collection style guide that is an object',
    config: blogConfig({ styleGuide: {} }),
    problems: [
      {
        path: `${BLOG}.styleGuide`,
        message: 'is an object; it must be a string',
        fix: STYLE_GUIDE_FIX,
      },
    ],
  },
  {
    name: 'a collection style guide that is null',
    config: blogConfig({ styleGuide: null }),
    problems: [
      { path: `${BLOG}.styleGuide`, message: 'is null; it must be a string', fix: STYLE_GUIDE_FIX },
    ],
  },
]

describe('a config with problems in the contracts of a collection', () => {
  it.each(contractCases)('reports $name', ({ config, problems }) => {
    expect(problemsOf(config)).toEqual(problems)
  })

  it('keeps a contract that is right exactly as it was given, with or without phases', () => {
    const both = contract({ id: 'on-both' })
    const onPublish = contract({ id: 'on-publish', phases: ['publish'] })
    const resolved = resolveConfig(withContracts(both, onPublish))
    const contracts = siteOf(resolved, 'demo').collections.get('blog')?.contracts
    expect(contracts?.[0]).toBe(both)
    expect(contracts?.[1]).toBe(onPublish)
    expect(contracts?.map((entry) => entry.id)).toEqual(['on-both', 'on-publish'])
    expect(contracts?.map((entry) => entry.phases)).toEqual([undefined, ['publish']])
  })
})

describe('a config with problems in the limits and the style guides', () => {
  it.each(limitCases)('reports $name', ({ config, problems }) => {
    expect(problemsOf(config)).toEqual(problems)
  })
})

describe('a config with several problems', () => {
  const broken = configWith({
    locales: ['es', 'EN'],
    defaultLocale: 'fr',
    collections: {
      Blog: collectionWith({
        routes: { es: '/blog/', en: '/en/blog/:slug/' },
        sortBy: 'title',
        contracts: [contract({ id: 'schema' })],
        maxMarkdownBytes: 0,
      }),
      news: collectionWith({ schema: 5 }),
    },
    styleGuide: 1,
  })

  const expected: readonly ConfigProblem[] = [
    { path: 'sites.demo.locales[1]', message: '"EN" is not a language tag', fix: LOCALE_FIX },
    {
      path: 'sites.demo.defaultLocale',
      message: 'is "fr", which is not one of the locales ("es", "EN")',
      fix: 'Set it to one of "es", "EN", or add "fr" to locales.',
    },
    {
      path: 'sites.demo.collections.Blog',
      message: '"Blog" is not a valid collection name',
      fix: 'Use lowercase letters, digits and hyphens, starting with a letter, at most 63 characters, such as "blog".',
    },
    {
      path: 'sites.demo.collections.Blog.routes.es',
      message: '"/blog/" has no :slug',
      fix: 'Use :slug exactly once, where the slug of the entry goes, such as "/blog/:slug/".',
    },
    {
      path: 'sites.demo.collections.Blog.sortBy',
      message:
        '"title" is declared as string, but it must be a string with the "date" or "date-time" format',
      fix: 'Declare "title" as z.iso.date() or z.iso.datetime() in the schema, or name another field.',
    },
    {
      path: 'sites.demo.collections.Blog.contracts[0].id',
      message: '"schema" is the id of a built-in contract',
      fix: RESERVED_FIX,
    },
    {
      path: 'sites.demo.collections.Blog.maxMarkdownBytes',
      message: 'is 0; it must be an integer from 1 to 786432',
      fix: SIZE_FIX,
    },
    {
      path: 'sites.demo.collections.news.schema',
      message: 'is 5; it must be a Standard Schema with JSON Schema',
      fix: 'Use a schema from a library that implements Standard Schema and Standard JSON Schema, such as zod 4.2 or later.',
    },
    {
      path: 'sites.demo.collections.news.routes.en',
      message:
        '"/en/blog/:slug/" is the same pattern as the route at sites.demo.collections.Blog.routes.en',
      fix: 'Give every route of the site its own path: internal links are matched against them.',
    },
    { path: 'sites.demo.styleGuide', message: 'is 1; it must be a string', fix: STYLE_GUIDE_FIX },
  ]

  it('reports every one of them, in the order of the config', () => {
    expect(problemsOf(broken)).toEqual(expected)
  })

  it('throws one ConfigError whose message has one line for each problem', () => {
    const thrown = thrownBy(() => resolveConfig(broken))
    expect(thrown).toBeInstanceOf(ConfigError)
    expect(thrown).toBeInstanceOf(Error)
    expect(thrown instanceof ConfigError ? thrown.name : thrown).toBe('ConfigError')
    expect(thrown instanceof ConfigError ? thrown.message.split('\n') : thrown).toEqual([
      'sites.demo.locales[1]: "EN" is not a language tag. ' + LOCALE_FIX,
      'sites.demo.defaultLocale: is "fr", which is not one of the locales ("es", "EN"). Set it to one of "es", "EN", or add "fr" to locales.',
      'sites.demo.collections.Blog: "Blog" is not a valid collection name. Use lowercase letters, digits and hyphens, starting with a letter, at most 63 characters, such as "blog".',
      'sites.demo.collections.Blog.routes.es: "/blog/" has no :slug. Use :slug exactly once, where the slug of the entry goes, such as "/blog/:slug/".',
      'sites.demo.collections.Blog.sortBy: "title" is declared as string, but it must be a string with the "date" or "date-time" format. Declare "title" as z.iso.date() or z.iso.datetime() in the schema, or name another field.',
      'sites.demo.collections.Blog.contracts[0].id: "schema" is the id of a built-in contract. ' +
        RESERVED_FIX,
      'sites.demo.collections.Blog.maxMarkdownBytes: is 0; it must be an integer from 1 to 786432. ' +
        SIZE_FIX,
      'sites.demo.collections.news.schema: is 5; it must be a Standard Schema with JSON Schema. Use a schema from a library that implements Standard Schema and Standard JSON Schema, such as zod 4.2 or later.',
      'sites.demo.collections.news.routes.en: "/en/blog/:slug/" is the same pattern as the route at sites.demo.collections.Blog.routes.en. Give every route of the site its own path: internal links are matched against them.',
      'sites.demo.styleGuide: is 1; it must be a string. ' + STYLE_GUIDE_FIX,
    ])
  })

  it('keeps a problem with odd characters in its key on one line', () => {
    const thrown = thrownBy(() => resolveConfig({ sites: { 'a\nb': siteWith() } }))
    expect(thrown instanceof Error ? thrown.message : thrown).toBe(
      'sites["a\\nb"]: "a\\nb" is not a valid site key. Use lowercase letters and digits joined by single hyphens, from 1 to 64 characters, such as "my-site".',
    )
  })

  it('holds each problem as data with a path, a message and a fix', () => {
    const [first] = problemsOf({ sites: { a: siteWith(), b: siteWith() } })
    expect(first).toStrictEqual({
      path: 'sites',
      message: 'has 2 sites ("a", "b"), and v0.1 serves exactly one site per deployment',
      fix: 'Keep exactly one site in sites.',
    })
  })
})

describe('a config of the wrong types', () => {
  const weird: readonly (readonly [string, unknown])[] = [
    ['null', null],
    ['a number', 1],
    ['a string', 'sites'],
    ['an array', []],
    ['null sites', { sites: null }],
    ['a null site', { sites: { a: null } }],
    ['an empty site', { sites: { a: {} } }],
    [
      'a site of nulls',
      { sites: { a: { locales: null, defaultLocale: null, collections: null } } },
    ],
    [
      'a collection of nulls',
      {
        sites: {
          a: {
            locales: ['en'],
            defaultLocale: 'en',
            collections: {
              b: {
                schema: null,
                routes: null,
                translations: null,
                tags: null,
                sortBy: null,
                components: null,
                contracts: null,
                maxMarkdownBytes: null,
                styleGuide: null,
              },
            },
          },
        },
      },
    ],
    [
      'components and contracts of nulls',
      {
        sites: {
          a: {
            locales: ['en'],
            defaultLocale: 'en',
            collections: {
              b: {
                schema: z.object({}),
                routes: { en: '/b/:slug/' },
                components: { c: null, d: { props: null, description: null, example: null } },
                contracts: [null, undefined, { phases: [null, undefined] }],
              },
            },
          },
        },
      },
    ],
    [
      'a collection that is an array',
      { sites: { a: { locales: ['en'], defaultLocale: 'en', collections: { b: [] } } } },
    ],
    [
      'locales that are all null',
      { sites: { a: { locales: [null, undefined], defaultLocale: 'en', collections: {} } } },
    ],
  ]

  it.each(weird)('is reported as problems, never as a crash: %s', (_name, config) => {
    const thrown = thrownBy(() => resolveConfig(config))
    expect(thrown).toBeInstanceOf(ConfigError)
    expect(thrown instanceof ConfigError ? thrown.problems.length > 0 : thrown).toBe(true)
  })
})
