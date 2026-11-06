import { describe, expect, it } from 'vite-plus/test'

import type { ConfigProblem } from '../../src/config/config-error.ts'
import { resolveConfig } from '../../src/config/resolve.ts'
import { BLOG, blogConfig, problemsOf, siteOf } from './support.ts'

const withNesting = (nesting: unknown) => blogConfig({ nesting })

const FIX = 'Set it to { maxDepth: 3 }, a depth from 2 to 10, or remove it for flat entries.'

interface Case {
  readonly name: string
  readonly config: unknown
  readonly problems: readonly ConfigProblem[]
}

const cases: readonly Case[] = [
  {
    name: 'a nesting that is a number',
    config: withNesting(3),
    problems: [
      {
        path: `${BLOG}.nesting`,
        message: 'is 3; it must be an object like { maxDepth }',
        fix: FIX,
      },
    ],
  },
  {
    name: 'a maxDepth that is missing',
    config: withNesting({}),
    problems: [
      {
        path: `${BLOG}.nesting.maxDepth`,
        message: 'is missing; it must be an integer from 2 to 10',
        fix: FIX,
      },
    ],
  },
  {
    name: 'a maxDepth of one level',
    config: withNesting({ maxDepth: 1 }),
    problems: [
      {
        path: `${BLOG}.nesting.maxDepth`,
        message: 'is 1; it must be an integer from 2 to 10',
        fix: FIX,
      },
    ],
  },
  {
    name: 'a maxDepth over the ceiling',
    config: withNesting({ maxDepth: 11 }),
    problems: [
      {
        path: `${BLOG}.nesting.maxDepth`,
        message: 'is 11; it must be an integer from 2 to 10',
        fix: FIX,
      },
    ],
  },
  {
    name: 'a maxDepth that is a fraction',
    config: withNesting({ maxDepth: 2.5 }),
    problems: [
      {
        path: `${BLOG}.nesting.maxDepth`,
        message: 'is 2.5; it must be an integer from 2 to 10',
        fix: FIX,
      },
    ],
  },
]

describe('a config with problems in the nesting of a collection', () => {
  it.each(cases)('reports $name', ({ config, problems }) => {
    expect(problemsOf(config)).toEqual(problems)
  })
})

function nestingOf(nesting: unknown) {
  return siteOf(resolveConfig(withNesting(nesting)), 'demo').collections.get('blog')?.nesting
}

describe('the nesting of a collection, resolved', () => {
  it('is null when the collection has none', () => {
    expect(nestingOf(undefined)).toBeNull()
  })

  it('keeps the depths at both ends of the range', () => {
    expect(nestingOf({ maxDepth: 2 })).toEqual({ maxDepth: 2 })
    expect(nestingOf({ maxDepth: 10 })).toEqual({ maxDepth: 10 })
  })
})
