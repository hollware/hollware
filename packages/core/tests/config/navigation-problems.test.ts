import { describe, expect, it } from 'vite-plus/test'
import * as z from 'zod'

import type { ConfigProblem } from '../../src/config/config-error.ts'
import { resolveConfig } from '../../src/config/resolve.ts'
import { BLOG, blogConfig, problemsOf, siteOf } from './support.ts'

const docs = z.object({
  title: z.string(),
  section: z.enum(['start', 'guides', 'reference']),
  kind: z.string(),
  order: z.number().int(),
  weight: z.number(),
  tags: z.array(z.string()),
})

const withNavigation = (navigation: unknown) => blogConfig({ schema: docs, navigation })

const FIELD_FIX = 'Set it to the name of a field of the frontmatter schema, or remove it.'

interface Case {
  readonly name: string
  readonly config: unknown
  readonly problems: readonly ConfigProblem[]
}

const cases: readonly Case[] = [
  {
    name: 'a navigation that is a string',
    config: withNavigation('section'),
    problems: [
      {
        path: `${BLOG}.navigation`,
        message: 'is "section"; it must be an object like { groupBy, groups, orderBy }',
        fix: 'Set it to { groupBy: "<field>", groups: [...], orderBy: "<field>" }, each part optional, or remove it.',
      },
    ],
  },
  {
    name: 'a groupBy that is a number',
    config: withNavigation({ groupBy: 3 }),
    problems: [
      {
        path: `${BLOG}.navigation.groupBy`,
        message: 'is 3; it must be the name of a frontmatter field',
        fix: FIELD_FIX,
      },
    ],
  },
  {
    name: 'a groupBy that names no property',
    config: withNavigation({ groupBy: 'chapter' }),
    problems: [
      {
        path: `${BLOG}.navigation.groupBy`,
        message: '"chapter" is not a property of the schema',
        fix: 'Name a field that the schema declares, or add "chapter" to the schema.',
      },
    ],
  },
  {
    name: 'a groupBy that names an array',
    config: withNavigation({ groupBy: 'tags' }),
    problems: [
      {
        path: `${BLOG}.navigation.groupBy`,
        message: '"tags" is declared as an array of string, but it must be a string or an enum',
        fix: 'Declare "tags" as z.string() or z.enum([...]) in the schema, or name another field.',
      },
    ],
  },
  {
    name: 'an orderBy that names a string',
    config: withNavigation({ orderBy: 'kind' }),
    problems: [
      {
        path: `${BLOG}.navigation.orderBy`,
        message: '"kind" is declared as string, but it must be a number',
        fix: 'Declare "kind" as z.number() or z.number().int() in the schema, or name another field.',
      },
    ],
  },
  {
    name: 'an orderBy that names no property',
    config: withNavigation({ orderBy: 'rank' }),
    problems: [
      {
        path: `${BLOG}.navigation.orderBy`,
        message: '"rank" is not a property of the schema',
        fix: 'Name a field that the schema declares, or add "rank" to the schema.',
      },
    ],
  },
  {
    name: 'groups without a groupBy',
    config: withNavigation({ groups: ['start'] }),
    problems: [
      {
        path: `${BLOG}.navigation.groups`,
        message: 'lists groups, but there is no groupBy to group by',
        fix: 'Add groupBy, the field whose value names the group, or remove groups.',
      },
    ],
  },
  {
    name: 'groups that are no array',
    config: withNavigation({ groupBy: 'kind', groups: 'start' }),
    problems: [
      {
        path: `${BLOG}.navigation.groups`,
        message: 'is "start"; it must be an array of group names',
        fix: 'List the groups in the order they come, such as ["start", "guides"], or remove it.',
      },
    ],
  },
  {
    name: 'groups that repeat one, or hold one that is empty',
    config: withNavigation({ groupBy: 'kind', groups: ['how-to', '', 'how-to'] }),
    problems: [
      {
        path: `${BLOG}.navigation.groups[1]`,
        message: 'is ""; it must be a group name',
        fix: 'Write each group as a non-empty string.',
      },
      {
        path: `${BLOG}.navigation.groups[2]`,
        message: 'repeats "how-to"',
        fix: 'Name each group once.',
      },
    ],
  },
  {
    name: 'groups of an enum that hold one of none of its values',
    config: withNavigation({ groupBy: 'section', groups: ['guides', 'faq'] }),
    problems: [
      {
        path: `${BLOG}.navigation.groups[1]`,
        message: '"faq" is not a value of the enum',
        fix: 'Use values of the enum: "start", "guides", "reference".',
      },
    ],
  },
]

describe('a config with problems in the navigation of a collection', () => {
  it.each(cases)('reports $name', ({ config, problems }) => {
    expect(problemsOf(config)).toEqual(problems)
  })
})

function navigationOf(navigation: unknown) {
  return siteOf(resolveConfig(withNavigation(navigation)), 'demo').collections.get('blog')
    ?.navigation
}

describe('the navigation of a collection, resolved', () => {
  it('is null when the collection has none', () => {
    expect(navigationOf(undefined)).toBeNull()
  })

  it('takes the order of the enum for groups that are not given', () => {
    expect(navigationOf({ groupBy: 'section', orderBy: 'weight' })).toEqual({
      groupBy: 'section',
      groups: ['start', 'guides', 'reference'],
      orderBy: 'weight',
    })
  })

  it('puts the groups given first, then the rest of the enum in its order', () => {
    expect(navigationOf({ groupBy: 'section', groups: ['reference'] })).toEqual({
      groupBy: 'section',
      groups: ['reference', 'start', 'guides'],
      orderBy: null,
    })
  })

  it('has no groups for a plain string that names none', () => {
    expect(navigationOf({ groupBy: 'kind', orderBy: 'order' })).toEqual({
      groupBy: 'kind',
      groups: null,
      orderBy: 'order',
    })
  })
})
