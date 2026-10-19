import { describe, expect, it } from 'vite-plus/test'

import { ConfigError } from '../../src/config/config-error.ts'
import { withAutomaticFields } from '../../src/config/automatic.ts'
import { toJsonSchema } from '../../src/config/json-schema.ts'
import { runContracts } from '../../src/contracts/index.ts'
import { compileSites } from '../../src/structure/compile.ts'
import { markdownOf, NO_LOOKUPS } from '../contracts/support.ts'

// Fails when (src/config/automatic.ts, src/structure/compile.ts):
// - "fills the dates …": firstPublished overrides a date that was written, or stays out of an entry
//   that was published; lastModified shows a revision written before the first publication, keeps
//   an earlier written date over a later change, or loses the format of its field; the reading
//   time is not the words at 200 a minute, at least one.
// - "takes a field …": a definition names a field the schema lacks, a date kind on a field that is
//   no date, a count on one that is no number, or a kind that is none, and compiles.
// - "is never required …": a field Hollware fills stays required, so a draft without it is
//   refused, or is not marked readOnly for agents.

const fields = {
  date: { kind: 'firstPublished', format: 'date' },
  modified: { kind: 'lastModified', format: 'date' },
  changed: { kind: 'lastModified', format: 'date-time' },
  minutes: { kind: 'readingTime', format: 'number' },
  words: { kind: 'wordCount', format: 'number' },
} as const

describe('withAutomaticFields', () => {
  it('fills the dates once the entry is published, and keeps what was written when it should', () => {
    const facts = {
      publishedAt: '2026-10-01T08:00:00.000Z',
      revisionCreatedAt: '2026-10-05T12:00:00.000Z',
      wordCount: 401,
    }

    const fresh = withAutomaticFields(fields, facts, { title: 'T' })
    const written = withAutomaticFields(fields, facts, {
      date: '2019-05-01',
      modified: '2027-01-01',
      minutes: 99,
    })
    const unchanged = withAutomaticFields(
      fields,
      { ...facts, revisionCreatedAt: '2026-09-30T08:00:00.000Z' },
      { modified: '2025-01-01' },
    )
    const draft = withAutomaticFields(
      fields,
      { publishedAt: null, revisionCreatedAt: facts.revisionCreatedAt, wordCount: 0 },
      {},
    )

    expect(fresh).toEqual({
      title: 'T',
      date: '2026-10-01',
      modified: '2026-10-05',
      changed: '2026-10-05T12:00:00.000Z',
      minutes: 3,
      words: 401,
    })
    expect([written['date'], written['modified'], written['minutes']]).toEqual([
      '2019-05-01',
      '2027-01-01',
      3,
    ])
    expect([unchanged['modified'], 'changed' in unchanged]).toEqual(['2025-01-01', false])
    expect(draft).toEqual({ minutes: 1, words: 0 })
  })
})

describe('a collection that names the fields Hollware fills', () => {
  const site = (schema: object, automaticFields: object) => ({
    blog: {
      locales: ['en'],
      defaultLocale: 'en',
      collections: { posts: { schema, routes: { en: '/:slug/' }, automaticFields } },
    },
  })
  const SCHEMA = {
    type: 'object',
    properties: {
      title: { type: 'string' },
      date: { type: 'string', format: 'date' },
      minutes: { type: 'integer' },
    },
    required: ['title', 'date', 'minutes'],
  }

  it('is never required to write them, and tells agents they are filled', async () => {
    const compiled = compileSites(site(SCHEMA, { date: 'firstPublished', minutes: 'readingTime' }))
    const posts = compiled.sites.get('blog')?.collections.get('posts')
    if (posts === undefined) throw new Error('no posts')

    const verdict = await runContracts({
      site:
        compiled.sites.get('blog') ??
        (() => {
          throw new Error('no blog')
        })(),
      collection: posts,
      locale: 'en',
      slug: 'a',
      entryId: null,
      phase: 'publish',
      markdown: markdownOf({ frontmatter: { title: 'A' } }),
      entries: NO_LOOKUPS,
    })
    const schema = toJsonSchema(posts.schema)

    expect(verdict.errors).toEqual([])
    expect(schema['required']).toEqual(['title'])
    expect(schema['properties']).toMatchObject({
      date: { readOnly: true },
      minutes: { readOnly: true },
    })
    expect(posts.automaticFields).toEqual({
      date: { kind: 'firstPublished', format: 'date' },
      minutes: { kind: 'readingTime', format: 'number' },
    })
  })

  it('takes a field the schema declares with the shape its kind fills, and nothing else', () => {
    let paths: readonly string[] = []
    try {
      compileSites(
        site(SCHEMA, {
          title: 'lastModified',
          date: 'wordCount',
          missing: 'firstPublished',
        }),
      )
    } catch (error) {
      if (error instanceof ConfigError) paths = error.problems.map((problem) => problem.path)
    }
    expect(paths).toEqual([
      'sites.blog.collections.posts.automatic.title',
      'sites.blog.collections.posts.automatic.date',
      'sites.blog.collections.posts.automatic.missing',
    ])
    let kinds: readonly string[] = []
    try {
      compileSites(site(SCHEMA, { minutes: 'soon' }))
    } catch (error) {
      if (error instanceof ConfigError) kinds = error.problems.map((problem) => problem.path)
    }
    expect(kinds).toEqual(['sites.blog.collections.posts.automaticFields.minutes'])
  })
})
