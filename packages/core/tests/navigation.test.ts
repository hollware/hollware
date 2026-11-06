import { describe, expect, it } from 'vite-plus/test'

import {
  arrangeNavigation,
  flattenNavigation,
  type Navigation,
  type NavigationSource,
  trailOf,
} from '../src/navigation.ts'

function page(slug: string, frontmatter: Record<string, unknown>): NavigationSource {
  return { slug, frontmatter }
}

const pathOf = (slug: string) => `/docs/${slug}/`

function arranged(
  entries: readonly NavigationSource[],
  navigation: Parameters<typeof arrangeNavigation>[0]['navigation'],
  locale = 'en',
) {
  return arrangeNavigation({ collection: 'docs', locale, navigation, entries, pathOf }).groups.map(
    (group) => [group.name, group.entries.map((entry) => entry.slug)],
  )
}

const SECTIONS = { groupBy: 'section', groups: ['start', 'guides', 'reference'], orderBy: 'order' }

describe('a navigation', () => {
  it('orders the groups as given, whatever order the entries come in', () => {
    const entries = [
      page('api', { title: 'API', section: 'reference', order: 1 }),
      page('deploy', { title: 'Deploy', section: 'guides', order: 1 }),
      page('install', { title: 'Install', section: 'start', order: 1 }),
    ]

    expect(arranged(entries, SECTIONS)).toEqual([
      ['start', ['install']],
      ['guides', ['deploy']],
      ['reference', ['api']],
    ])
  })

  it('puts groups that are not listed after the listed ones, by name, and entries with no group last', () => {
    const entries = [
      page('loose', { title: 'Loose' }),
      page('zeta', { title: 'Zeta', section: 'zoo' }),
      page('alpha', { title: 'Alpha', section: 'appendix' }),
      page('install', { title: 'Install', section: 'start' }),
    ]

    expect(arranged(entries, SECTIONS)).toEqual([
      ['start', ['install']],
      ['appendix', ['alpha']],
      ['zoo', ['zeta']],
      [null, ['loose']],
    ])
  })

  it('orders groups by name when none are given', () => {
    const entries = [
      page('b', { title: 'B', kind: 'tutorial' }),
      page('a', { title: 'A', kind: 'concept' }),
    ]

    expect(arranged(entries, { groupBy: 'kind', groups: null, orderBy: null })).toEqual([
      ['concept', ['a']],
      ['tutorial', ['b']],
    ])
  })

  it('orders a group by orderBy, lowest first and those without it last, then by title, then by slug', () => {
    const entries = [
      page('unordered', { title: 'Aardvark', section: 'start' }),
      page('third', { title: 'Third', section: 'start', order: 10 }),
      page('second-b', { title: 'Same', section: 'start', order: 2 }),
      page('second-a', { title: 'Same', section: 'start', order: 2 }),
      page('apple', { title: 'Apple', section: 'start', order: 2 }),
      page('first', { title: 'Zulu', section: 'start', order: 1 }),
    ]

    expect(arranged(entries, SECTIONS)).toEqual([
      ['start', ['first', 'apple', 'second-a', 'second-b', 'third', 'unordered']],
    ])
  })

  it('compares titles in the locale it reads', () => {
    const entries = [
      page('zebra', { title: 'zebra' }),
      page('ol', { title: 'öl' }),
      page('orm', { title: 'orm' }),
    ]

    expect(arranged(entries, null, 'sv')).toEqual([[null, ['orm', 'zebra', 'ol']]])
    expect(arranged(entries, null, 'en')).toEqual([[null, ['ol', 'orm', 'zebra']]])
  })

  it('is one group of every entry by title without a navigation, its order ignored', () => {
    const entries = [
      page('b', { title: 'Beta', section: 'start', order: 1 }),
      page('a', { title: 'Alpha', section: 'guides', order: 9 }),
    ]

    expect(
      arrangeNavigation({ collection: 'docs', locale: 'en', navigation: null, entries, pathOf }),
    ).toEqual({
      outcome: 'ok',
      collection: 'docs',
      locale: 'en',
      groups: [
        {
          name: null,
          entries: [
            {
              slug: 'a',
              title: 'Alpha',
              description: null,
              path: '/docs/a/',
              order: null,
              parent: null,
              children: [],
            },
            {
              slug: 'b',
              title: 'Beta',
              description: null,
              path: '/docs/b/',
              order: null,
              parent: null,
              children: [],
            },
          ],
        },
      ],
    })
  })

  it('links each entry by its title, description, path and order, its slug standing for a missing title', () => {
    const entries = [
      page('untitled', { section: 'start', order: 'first' }),
      page('intro', { title: 'Intro', description: 'Where to begin.', section: 'start', order: 0 }),
    ]

    expect(
      arrangeNavigation({
        collection: 'docs',
        locale: 'en',
        navigation: SECTIONS,
        entries,
        pathOf: (slug) => (slug === 'intro' ? '/docs/intro/' : null),
      }).groups,
    ).toEqual([
      {
        name: 'start',
        entries: [
          {
            slug: 'intro',
            title: 'Intro',
            description: 'Where to begin.',
            path: '/docs/intro/',
            order: 0,
            parent: null,
            children: [],
          },
          {
            slug: 'untitled',
            title: 'untitled',
            description: null,
            path: null,
            order: null,
            parent: null,
            children: [],
          },
        ],
      },
    ])
  })
})

function child(
  slug: string,
  parent: string | null,
  position: number,
  slugPath: string,
  frontmatter: Record<string, unknown> = { title: slug },
): NavigationSource {
  return { slug, frontmatter, parent, position, slugPath }
}

type Shape = readonly [string, string | null, Shape[]]

function shapeOf(navigation: Navigation): Shape[][] {
  const walk = (entries: Navigation['groups'][number]['entries']): Shape[] =>
    entries.map((entry) => [entry.slug, entry.path, walk(entry.children)])
  return navigation.groups.map((group) => walk(group.entries))
}

const HELP = [
  child('payments', 'billing', 1, 'billing/payments'),
  child('refunds', 'payments', 0, 'billing/payments/refunds'),
  child('invoices', 'billing', 0, 'billing/invoices'),
  child('account', null, 0, 'account'),
  child('billing', null, 1, 'billing'),
  child('cards', 'payments', 1, 'billing/payments/cards'),
]

function nestedHelp(entries: readonly NavigationSource[] = HELP, nested = true): Navigation {
  return arrangeNavigation({
    collection: 'help',
    locale: 'en',
    navigation: null,
    nested,
    entries,
    pathOf: (slugPath) => `/help/${slugPath}/`,
  })
}

describe('the navigation of a nested collection', () => {
  it('is a tree of the roots, each entry holding its children by position, at their paths', () => {
    expect(shapeOf(nestedHelp())).toEqual([
      [
        ['account', '/help/account/', []],
        [
          'billing',
          '/help/billing/',
          [
            ['invoices', '/help/billing/invoices/', []],
            [
              'payments',
              '/help/billing/payments/',
              [
                ['refunds', '/help/billing/payments/refunds/', []],
                ['cards', '/help/billing/payments/cards/', []],
              ],
            ],
          ],
        ],
      ],
    ])
  })

  it('names the parent of each entry', () => {
    const billing = nestedHelp().groups[0]?.entries[1]
    expect(billing?.parent).toBeNull()
    expect(billing?.children.map((entry) => [entry.slug, entry.parent])).toEqual([
      ['invoices', 'billing'],
      ['payments', 'billing'],
    ])
  })

  it('makes a root of an entry whose parent is not among the entries', () => {
    const entries = [child('orphan', 'gone', 0, 'gone/orphan'), child('top', null, 1, 'top')]
    expect(shapeOf(nestedHelp(entries))).toEqual([
      [
        ['orphan', '/help/gone/orphan/', []],
        ['top', '/help/top/', []],
      ],
    ])
  })

  it('orders siblings of the same position by title', () => {
    const entries = [
      child('b', null, 0, 'b', { title: 'Zulu' }),
      child('a', null, 0, 'a', { title: 'Alpha' }),
    ]
    expect(shapeOf(nestedHelp(entries))).toEqual([
      [
        ['a', '/help/a/', []],
        ['b', '/help/b/', []],
      ],
    ])
  })

  it('ignores parents when the collection is flat', () => {
    expect(shapeOf(nestedHelp(HELP, false))[0]?.map(([slug]) => slug)).toEqual([
      'account',
      'billing',
      'cards',
      'invoices',
      'payments',
      'refunds',
    ])
  })

  it('lists the entries depth first, for previous and next', () => {
    expect(flattenNavigation(nestedHelp()).map((entry) => entry.slug)).toEqual([
      'account',
      'billing',
      'invoices',
      'payments',
      'refunds',
      'cards',
    ])
  })

  it('gives the trail from the root down to an entry, for breadcrumbs', () => {
    expect(trailOf(nestedHelp(), 'cards').map((entry) => entry.slug)).toEqual([
      'billing',
      'payments',
      'cards',
    ])
    expect(trailOf(nestedHelp(), 'missing')).toEqual([])
  })
})
