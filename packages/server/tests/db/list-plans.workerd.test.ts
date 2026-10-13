import { env } from 'cloudflare:workers'
import { beforeAll, describe, expect, it } from 'vitest'

import { encodeCursor, type CursorPosition } from '../../src/db/cursor.ts'
import { connect } from '../../src/db/d1.ts'
import { createD1Store } from '../../src/db/index.ts'
import { listEntriesQuery, listTranslationsQuery } from '../../src/db/reads.ts'
import type { ListQuery } from '../../src/ports.ts'
import { recordStatements, seedOwner, siteKey } from './support.ts'

// Fails when: src/db/reads.ts sends a listing in a shape that SQLite cannot serve from an index of
// `entries`, so that a page sorts the whole collection or reads it from its first row: the head
// view stops using `entries_head` (or `entries_head_locale` when it names a locale), the
// published view of a locale stops using the partial `entries_published` (its status is not the
// literal the index says, or it orders by another column), the cursor stops being a row value
// that the index seeks to, a translation group stops being read in order of locale from
// `entries_translation`, or `listEntries` or `listTranslations` stop sending the statement these
// plans explain. Each plan is read on 1,080 entries, before and after ANALYZE, with the values a
// listing is sent with and with values that nothing matches (the plan must not lean on them).

const ENTRIES = 3 * 3 * 120

/** Three collections of three locales of 120 entries each, half of them published, in one statement. */
async function seedCollections(site: string): Promise<void> {
  await env.DB.prepare(
    `WITH RECURSIVE n(i) AS (SELECT 1 UNION ALL SELECT i + 1 FROM n WHERE i < 120)
      INSERT INTO entries (id, site_id, collection, locale, slug, translation_group, status, version,
        head_rev, published_rev, published_at, published_sort_key, created_at, updated_at)
      SELECT c.collection || '_' || l.locale || '_' || n.i || '_' || ?1, ?1, c.collection, l.locale,
        'slug-' || n.i, 'group-' || n.i,
        CASE WHEN n.i % 2 = 0 THEN 'published' ELSE 'draft' END, 1, 'rev_' || n.i,
        CASE WHEN n.i % 2 = 0 THEN 'rev_' || n.i END,
        CASE WHEN n.i % 2 = 0 THEN '2026-10-01T00:00:00.000Z' END,
        CASE WHEN n.i % 2 = 0 THEN printf('k%03d', n.i % 40) END,
        '2026-10-01T00:00:00.000Z', printf('2026-10-12T%02d:%02d:00.000Z', n.i % 24, n.i % 60)
      FROM n,
        (SELECT 'blog' AS collection UNION ALL SELECT 'docs' UNION ALL SELECT 'news') c,
        (SELECT 'en' AS locale UNION ALL SELECT 'es' UNION ALL SELECT 'pt') l`,
  )
    .bind(site)
    .run()
}

interface Shape {
  readonly name: string
  readonly query: ListQuery
  readonly after?: CursorPosition
  /** The one line of the plan that reads `entries`. */
  readonly access: string
}

const HEAD_AFTER = { key: '2026-10-12T10:00:00.000Z', id: 'blog_en_5_x' }
const PUBLISHED_AFTER = { key: 'k020', id: 'blog_en_60_x' }

const SHAPES: readonly Shape[] = [
  {
    name: 'the head view of a collection',
    query: { collection: 'blog', view: 'head', limit: 20 },
    access: 'SEARCH entries USING INDEX entries_head (site_id=? AND collection=?)',
  },
  {
    name: 'the head view of a collection after a cursor',
    query: { collection: 'blog', view: 'head', limit: 20 },
    after: HEAD_AFTER,
    access:
      'SEARCH entries USING INDEX entries_head (site_id=? AND collection=? AND (updated_at,id)<(?,?))',
  },
  {
    name: 'the head view of a locale',
    query: { collection: 'blog', view: 'head', limit: 20, locale: 'en' },
    access:
      'SEARCH entries USING INDEX entries_head_locale (site_id=? AND collection=? AND locale=?)',
  },
  {
    name: 'the head view of a locale after a cursor',
    query: { collection: 'blog', view: 'head', limit: 20, locale: 'en' },
    after: HEAD_AFTER,
    access:
      'SEARCH entries USING INDEX entries_head_locale (site_id=? AND collection=? AND locale=? AND (updated_at,id)<(?,?))',
  },
  {
    name: 'the head view of a locale, of one status',
    query: { collection: 'blog', view: 'head', limit: 20, locale: 'en', status: 'draft' },
    access:
      'SEARCH entries USING INDEX entries_head_locale (site_id=? AND collection=? AND locale=?)',
  },
  {
    name: 'the head view of a locale, of one tag',
    query: { collection: 'blog', view: 'head', limit: 20, locale: 'en', tag: 'edge' },
    access:
      'SEARCH entries USING INDEX entries_head_locale (site_id=? AND collection=? AND locale=?)',
  },
  {
    name: 'the published view of a locale',
    query: { collection: 'blog', view: 'published', limit: 20, locale: 'en' },
    access:
      'SEARCH entries USING INDEX entries_published (site_id=? AND collection=? AND locale=?)',
  },
  {
    name: 'the published view of a locale after a cursor',
    query: { collection: 'blog', view: 'published', limit: 20, locale: 'en' },
    after: PUBLISHED_AFTER,
    access:
      'SEARCH entries USING INDEX entries_published (site_id=? AND collection=? AND locale=? AND (published_sort_key,id)<(?,?))',
  },
  {
    name: 'the published view of a locale, of one tag',
    query: { collection: 'blog', view: 'published', limit: 20, locale: 'en', tag: 'edge' },
    access:
      'SEARCH entries USING INDEX entries_published (site_id=? AND collection=? AND locale=?)',
  },
]

const TRANSLATIONS_ACCESS =
  'SEARCH entries USING INDEX entries_translation (site_id=? AND collection=? AND translation_group=?)'

/** The lines of the plan of a statement, with the values it binds. */
async function plan(statement: string, params: readonly unknown[]): Promise<string[]> {
  const { results } = await env.DB.prepare(`EXPLAIN QUERY PLAN ${statement}`)
    .bind(...params)
    .all<{ detail: string }>()
  return results.map((row) => row.detail)
}

const readsEntries = (line: string) => /^(SEARCH|SCAN) entries\b/.test(line)

/**
 * The values a statement binds, and the same with every text replaced by one that no row has.
 * SQLite may look at bound values when it plans, so a plan is read both ways: it has to hold for
 * the values a listing is sent with, and for values that nothing matches.
 */
const boundValues = (params: readonly unknown[]): (readonly unknown[])[] => [
  params,
  params.map((value) => (typeof value === 'string' ? '~' : value)),
]

let site = ''

beforeAll(async () => {
  site = siteKey('plans')
  await seedOwner(env.DB, site)
  await seedCollections(site)
})

function describePlans(when: string) {
  describe(`the plan of a listing ${when}`, () => {
    it.each(SHAPES)('reads $name from its index, in order, with no sort', async (shape) => {
      const after = shape.after ?? null
      const { sql, params } = listEntriesQuery(connect(env.DB), site, shape.query, after).toSQL()

      for (const values of boundValues(params)) {
        const lines = await plan(sql, values)

        expect(lines.filter(readsEntries)).toEqual([shape.access])
        expect(lines).not.toContain('USE TEMP B-TREE FOR ORDER BY')
      }
    })

    it.each(['head', 'published'] as const)(
      'reads the translations of a group in the %s view from the key of the group, in order of locale, with no sort',
      async (view) => {
        const { sql, params } = listTranslationsQuery(
          connect(env.DB),
          site,
          'blog',
          'group-5',
          view,
        ).toSQL()

        for (const values of boundValues(params)) {
          const lines = await plan(sql, values)

          expect(lines.filter(readsEntries)).toEqual([TRANSLATIONS_ACCESS])
          expect(lines).not.toContain('USE TEMP B-TREE FOR ORDER BY')
        }
      },
    )
  })
}

describe('the entries these plans are read on', () => {
  it('are 1,080, in three collections of three locales', async () => {
    const count = await env.DB.prepare('SELECT count(*) AS n FROM entries WHERE site_id = ?')
      .bind(site)
      .first<number>('n')

    expect(count).toBe(ENTRIES)
  })
})

describe('listEntries and listTranslations', () => {
  it.each(SHAPES)('send the statement whose plan is read for $name', async (shape) => {
    const after = shape.after ?? null
    const { sql } = listEntriesQuery(connect(env.DB), site, shape.query, after).toSQL()
    const { db, prepared } = recordStatements(env.DB)

    await createD1Store(db).listEntries(site, {
      ...shape.query,
      ...(after === null ? {} : { cursor: encodeCursor(shape.query.view, after) }),
    })

    expect(prepared).toEqual([sql])
  })

  it.each(['head', 'published'] as const)(
    'send the statement whose plan is read for the translations of a group in the %s view',
    async (view) => {
      const { sql } = listTranslationsQuery(connect(env.DB), site, 'blog', 'group-5', view).toSQL()
      const { db, prepared } = recordStatements(env.DB)

      await createD1Store(db).listTranslations(site, 'blog', 'group-5', view)

      expect(prepared).toEqual([sql])
    },
  )
})

describePlans('before ANALYZE')

describe('ANALYZE', () => {
  beforeAll(async () => {
    await env.DB.prepare('ANALYZE').run()
  })

  it('gives the planner the statistics of the three indexes of the listings', async () => {
    const { results } = await env.DB.prepare(
      "SELECT idx FROM sqlite_stat1 WHERE tbl = 'entries' ORDER BY idx",
    ).all<{ idx: string }>()

    expect(results.map((row) => row.idx)).toEqual(
      expect.arrayContaining(['entries_head', 'entries_head_locale', 'entries_published']),
    )
  })

  describePlans('after ANALYZE')
})
