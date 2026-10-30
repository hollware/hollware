import { describe, expect, it } from 'vite-plus/test'
import * as z from 'zod'

import { describeResolvedSite } from '../../src/config/describe.ts'
import { resolveConfig } from '../../src/config/resolve.ts'
import { type ContractDescription, contracts } from '../../src/contracts/index.ts'
import { siteDescription } from '../../src/operations/schemas.ts'
import {
  blogConfig,
  collectionWith,
  countingSchema,
  schemaOf,
  siteOf,
  siteWith,
  thrownBy,
} from './support.ts'

const check = () => []
const DRAFT = 'https://json-schema.org/draft/2020-12/schema'

const own = [
  { id: 'title-length', severity: 'warning', description: 'A short title.', check },
  {
    id: 'review',
    severity: 'error',
    phases: ['publish'],
    description: 'A reviewer signs off.',
    check,
  },
]

const docsConfig = (collections: Record<string, unknown> = {}) => ({
  sites: {
    docs: {
      locales: ['en', 'es'],
      defaultLocale: 'en',
      url: 'https://docs.example.com',
      styleGuide: 'Write for beginners.',
      collections: {
        guides: {
          schema: z.object({ title: z.string().min(1), tags: z.array(z.string()).optional() }),
          routes: { es: '/es/guias/:slug/', en: '/guides/:slug/' },
          tags: 'tags',
          components: {
            callout: {
              props: z.strictObject({ type: z.enum(['info', 'tip']) }),
              description: 'A note.',
              example: '::callout{type="tip"}\nHi\n::',
            },
            badge: { props: z.strictObject({}) },
          },
          contracts: own,
          maxMarkdownBytes: 100_000,
          styleGuide: 'Short sections.',
        },
        ...collections,
      },
    },
  },
})

const siteOfDocs = (config: unknown = docsConfig()) => siteOf(resolveConfig(config), 'docs')

const builtInA: readonly ContractDescription[] = [
  {
    id: 'schema',
    severity: 'error',
    phases: ['write', 'publish'],
    description: 'It matches the schema.',
  },
]
const builtInB: readonly ContractDescription[] = [
  { id: 'raw-html', severity: 'error', phases: ['write'], description: 'No raw HTML.' },
]

describe('describeResolvedSite', () => {
  it('describes a site as the describe_site operation shows it', () => {
    expect(describeResolvedSite(siteOfDocs(), { builtInContracts: builtInA })).toStrictEqual({
      key: 'docs',
      locales: ['en', 'es'],
      defaultLocale: 'en',
      url: 'https://docs.example.com',
      styleGuide: 'Write for beginners.',
      collections: [
        {
          name: 'guides',
          schema: {
            $schema: DRAFT,
            type: 'object',
            properties: {
              title: { type: 'string', minLength: 1 },
              tags: { type: 'array', items: { type: 'string' } },
            },
            required: ['title'],
          },
          routes: { en: '/guides/:slug/', es: '/es/guias/:slug/' },
          translationGroupField: null,
          tagsField: 'tags',
          sortByField: null,
          components: [
            {
              name: 'callout',
              description: 'A note.',
              example: '::callout{type="tip"}\nHi\n::',
              props: {
                $schema: DRAFT,
                type: 'object',
                properties: { type: { type: 'string', enum: ['info', 'tip'] } },
                required: ['type'],
                additionalProperties: false,
              },
            },
            {
              name: 'badge',
              description: null,
              example: null,
              props: {
                $schema: DRAFT,
                type: 'object',
                properties: {},
                additionalProperties: false,
              },
            },
          ],
          contracts: [
            {
              id: 'schema',
              severity: 'error',
              phases: ['write', 'publish'],
              description: 'It matches the schema.',
            },
            {
              id: 'title-length',
              severity: 'warning',
              phases: ['write', 'publish'],
              description: 'A short title.',
            },
            {
              id: 'review',
              severity: 'error',
              phases: ['publish'],
              description: 'A reviewer signs off.',
            },
          ],
          maxMarkdownBytes: 100000,
          styleGuide: 'Short sections.',
        },
      ],
    })
  })

  it('has the shape of the site that describe_site declares', () => {
    const description = describeResolvedSite(siteOfDocs(), { builtInContracts: builtInA })
    expect(siteDescription.parse(description)).toEqual(description)
  })

  it('writes null for what the config leaves out, and lists no contract without any', () => {
    const resolved = resolveConfig({
      sites: {
        notes: {
          locales: ['en'],
          defaultLocale: 'en',
          collections: {
            posts: { schema: z.object({ title: z.string() }), routes: { en: '/posts/:slug/' } },
          },
        },
      },
    })
    expect(describeResolvedSite(siteOf(resolved, 'notes'))).toStrictEqual({
      key: 'notes',
      locales: ['en'],
      defaultLocale: 'en',
      url: null,
      styleGuide: null,
      collections: [
        {
          name: 'posts',
          schema: {
            $schema: DRAFT,
            type: 'object',
            properties: { title: { type: 'string' } },
            required: ['title'],
          },
          routes: { en: '/posts/:slug/' },
          translationGroupField: null,
          tagsField: null,
          sortByField: null,
          components: [],
          contracts: [],
          maxMarkdownBytes: 524288,
          styleGuide: null,
        },
      ],
    })
  })

  it('names the fields of a collection: the translation group, the tags and the sorting field', () => {
    const site = siteOfDocs(
      docsConfig({
        posts: {
          schema: z.object({ group: z.string(), day: z.iso.date() }),
          routes: { en: '/p/:slug/', es: '/es/p/:slug/' },
          translations: { groupBy: 'group' },
          sortBy: 'day',
        },
      }),
    )
    const posts = describeResolvedSite(site).collections[1]
    expect(posts?.name).toBe('posts')
    expect([posts?.translationGroupField, posts?.tagsField, posts?.sortByField]).toEqual([
      'group',
      null,
      'day',
    ])
    expect(Object.keys(posts ?? {})).toEqual([
      'name',
      'schema',
      'routes',
      'translationGroupField',
      'tagsField',
      'sortByField',
      'components',
      'contracts',
      'maxMarkdownBytes',
      'styleGuide',
    ])
  })

  it('shows the navigation of a collection that has one, with the groups of its enum', () => {
    const site = siteOfDocs(
      docsConfig({
        pages: {
          schema: z.object({ part: z.enum(['basics', 'advanced']), rank: z.number() }),
          routes: { en: '/pages/:slug/', es: '/es/pages/:slug/' },
          navigation: { groupBy: 'part', orderBy: 'rank' },
        },
      }),
    )
    const [guides, pages] = describeResolvedSite(site).collections
    expect(pages?.navigation).toEqual({
      groupBy: 'part',
      groups: ['basics', 'advanced'],
      orderBy: 'rank',
    })
    expect(guides !== undefined && 'navigation' in guides).toBe(false)
  })

  it('lists collections, components and routes in the order of the config and the locales', () => {
    const site = siteOfDocs(
      docsConfig({ aaa: collectionWith({ routes: { es: '/a/:slug/', en: '/en/a/:slug/' } }) }),
    )
    const description = describeResolvedSite(site)
    expect(description.collections.map((collection) => collection.name)).toEqual(['guides', 'aaa'])
    expect(description.collections[0]?.components.map((component) => component.name)).toEqual([
      'callout',
      'badge',
    ])
    expect(Object.keys(description.collections[0]?.routes ?? {})).toEqual(['en', 'es'])
  })

  it('gives each contract its own phases, both by default, and keeps the order of the config', () => {
    const contracts = describeResolvedSite(siteOfDocs()).collections[0]?.contracts
    expect(contracts?.map((contract) => contract.id)).toEqual(['title-length', 'review'])
    expect(contracts?.map((contract) => contract.phases)).toEqual([
      ['write', 'publish'],
      ['publish'],
    ])
    const [first, second] = [
      describeResolvedSite(siteOfDocs(docsConfig())).collections[0]?.contracts[0]?.phases,
      describeResolvedSite(siteOfDocs(docsConfig())).collections[0]?.contracts[0]?.phases,
    ]
    expect(first).not.toBe(second)
  })

  it('describes the phases of every contract in their natural order, as the contracts module does', () => {
    const late = {
      id: 'late',
      severity: 'error',
      phases: ['publish', 'write'],
      description: 'Both phases, in the wrong order.',
      check,
    }
    const site = siteOf(
      resolveConfig(blogConfig({ contracts: [late, contracts.translationPair()] })),
      'demo',
    )
    const builtIn: readonly ContractDescription[] = [
      { id: 'schema', severity: 'error', phases: ['publish', 'write'], description: 'x' },
    ]
    const described = describeResolvedSite(site, { builtInContracts: builtIn }).collections[0]
      ?.contracts
    expect(described?.map((contract) => [contract.id, contract.phases])).toEqual([
      ['schema', ['write', 'publish']],
      ['late', ['write', 'publish']],
      ['translation-pair', ['publish']],
    ])
  })

  it('describes a built-in contract by its four fields, whatever else its object carries', () => {
    const richer: ContractDescription & { readonly implementation: string } = {
      id: 'size-limit',
      severity: 'error',
      phases: ['write'],
      description: 'The file is small enough.',
      implementation: 'a detail that agents have no use for',
    }
    const contracts = describeResolvedSite(siteOfDocs(), { builtInContracts: [richer] })
      .collections[0]?.contracts
    expect(contracts?.[0]).toStrictEqual({
      id: 'size-limit',
      severity: 'error',
      phases: ['write'],
      description: 'The file is small enough.',
    })
    expect(contracts?.[0]?.phases).not.toBe(richer.phases)
  })

  it('describes the same config the same way, and byte for byte', () => {
    const first = describeResolvedSite(siteOfDocs(), { builtInContracts: builtInA })
    const second = describeResolvedSite(siteOfDocs(), { builtInContracts: builtInA })
    expect(second).not.toBe(first)
    expect(second).toEqual(first)
    expect(JSON.stringify(second)).toBe(JSON.stringify(first))
  })
})

describe('describeResolvedSite memoization', () => {
  const frontmatter = countingSchema({ type: 'object', properties: { title: { type: 'string' } } })
  const props = countingSchema({ type: 'object', properties: {}, additionalProperties: false })
  const site = siteOf(
    resolveConfig({
      sites: {
        demo: siteWith({
          collections: {
            blog: collectionWith({
              schema: frontmatter.schema,
              components: { badge: { props: props.schema } },
            }),
          },
        }),
      },
    }),
    'demo',
  )
  const conversions = () => [frontmatter.conversions(), props.conversions()]

  it('converts each schema once for a site and hands back the same object after that', () => {
    expect(conversions()).toEqual([1, 1])
    const first = describeResolvedSite(site)
    expect(conversions()).toEqual([2, 2])
    const second = describeResolvedSite(site)
    expect(second).toBe(first)
    expect(describeResolvedSite(site, {})).toBe(first)
    expect(describeResolvedSite(site, { builtInContracts: undefined })).toBe(first)
    expect(conversions()).toEqual([2, 2])
  })

  it('makes one description for each list of built-in contracts, and none is stale', () => {
    const ids = (description: ReturnType<typeof describeResolvedSite>) =>
      description.collections[0]?.contracts.map((contract) => contract.id)
    const without = describeResolvedSite(site)
    const withA = describeResolvedSite(site, { builtInContracts: builtInA })
    const withB = describeResolvedSite(site, { builtInContracts: builtInB })
    expect([ids(without), ids(withA), ids(withB)]).toEqual([[], ['schema'], ['raw-html']])
    expect(withA).not.toBe(without)
    expect(withB).not.toBe(withA)
    expect(describeResolvedSite(site, { builtInContracts: builtInA })).toBe(withA)
    expect(describeResolvedSite(site, { builtInContracts: builtInB })).toBe(withB)
    expect(describeResolvedSite(site)).toBe(without)
  })

  it('makes one description for each site, even when two sites are alike', () => {
    const other = siteOf(
      resolveConfig({ sites: { demo: siteWith({ collections: { blog: collectionWith() } }) } }),
      'demo',
    )
    const twin = siteOf(
      resolveConfig({ sites: { demo: siteWith({ collections: { blog: collectionWith() } }) } }),
      'demo',
    )
    expect(describeResolvedSite(twin)).not.toBe(describeResolvedSite(other))
    expect(describeResolvedSite(twin)).toEqual(describeResolvedSite(other))
  })
})

describe('what describeResolvedSite shares and what it leaves alone', () => {
  it('freezes the description, because every request of the isolate gets the same one', () => {
    const description = describeResolvedSite(siteOfDocs())
    const collection = description.collections[0]
    expect(Object.isFrozen(description)).toBe(true)
    expect(Object.isFrozen(description.locales)).toBe(true)
    expect(Object.isFrozen(collection)).toBe(true)
    expect(Object.isFrozen(collection?.schema)).toBe(true)
    expect(Object.isFrozen(collection?.components[0]?.props)).toBe(true)
    expect(Object.isFrozen(collection?.contracts[0]?.phases)).toBe(true)
    const change = () =>
      collection?.contracts.push({ id: 'x', severity: 'error', phases: [], description: 'x' })
    expect(thrownBy(change)).toBeInstanceOf(TypeError)
  })

  it('freezes nothing it was given: not the config, the built-in contracts nor the library', () => {
    const library = { type: 'object', properties: { title: { type: 'string' } } }
    const phases = ['publish']
    const config = {
      sites: {
        demo: siteWith({
          collections: {
            blog: collectionWith({
              schema: schemaOf(library),
              contracts: [{ id: 'review', severity: 'error', phases, description: 'x', check }],
            }),
          },
        }),
      },
    }
    const builtIn: ContractDescription[] = [
      { id: 'schema', severity: 'error', phases: ['write'], description: 'x' },
    ]
    const site = siteOf(resolveConfig(config), 'demo')
    const description = describeResolvedSite(site, { builtInContracts: builtIn })
    expect(description.collections[0]?.schema).toEqual(library)
    expect(description.collections[0]?.schema).not.toBe(library)
    const routes = site.collections.get('blog')?.routes
    expect(
      [library, phases, builtIn, builtIn[0], builtIn[0]?.phases, site, site.locales, routes].map(
        (value) => Object.isFrozen(value),
      ),
    ).toEqual([false, false, false, false, false, false, false, false])
  })
})
