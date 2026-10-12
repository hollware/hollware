import { isPersonalToken } from '@hollware/core'
import { env } from 'cloudflare:workers'
import { describe, expect, it } from 'vitest'

import { seedSite } from './support/sites.ts'

// Fails when: seedSite stops writing a whole site that the schema accepts (its checks, composite
// foreign keys and append-only triggers), or two seeded sites stop sharing their natural keys, which
// is what lets a stranger test catch a query that forgets `site_id`.

const TABLES = ['entries', 'revisions', 'revision_tags', 'publications', 'tokens'] as const

async function rowsPerTable(site: string): Promise<Record<string, number>> {
  const counts: Record<string, number> = {}
  for (const table of TABLES) {
    counts[table] =
      (await env.DB.prepare(`SELECT count(*) AS n FROM ${table} WHERE site_id = ?`)
        .bind(site)
        .first<number>('n')) ?? 0
  }
  return counts
}

describe('seedSite', () => {
  it('writes two sites with the same natural keys and their own rows', async () => {
    const suffix = crypto.randomUUID()
    const home = await seedSite(env.DB, `home-${suffix}`)
    const stranger = await seedSite(env.DB, `stranger-${suffix}`)

    const expected = { entries: 3, revisions: 3, revision_tags: 3, publications: 2, tokens: 1 }
    expect(await rowsPerTable(home.site)).toEqual(expected)
    expect(await rowsPerTable(stranger.site)).toEqual(expected)

    const keys = (seeded: typeof home) =>
      seeded.entries.map((entry) => `${entry.locale}/${entry.slug}/${entry.status}`)
    expect(keys(stranger)).toEqual(keys(home))
    expect(stranger.entries.map((entry) => entry.id)).not.toEqual(
      home.entries.map((entry) => entry.id),
    )
    // Each published entry has its revision published and one publication; a draft has neither.
    const { results } = await env.DB.prepare(
      `SELECT e.slug, e.status, e.published_rev = e.head_rev AS live, count(p.id) AS publications
        FROM entries e LEFT JOIN publications p ON p.entry_id = e.id AND p.site_id = e.site_id
        WHERE e.site_id = ? GROUP BY e.id ORDER BY e.slug`,
    )
      .bind(stranger.site)
      .all()
    expect(results).toEqual([
      { slug: 'cache-en-el-borde', status: 'published', live: 1, publications: 1 },
      { slug: 'edge-caching-basics', status: 'published', live: 1, publications: 1 },
      { slug: 'from-draft-to-published', status: 'draft', live: null, publications: 0 },
    ])
    expect(isPersonalToken(stranger.token)).toBe(true)
    expect(stranger.token).not.toBe(home.token)
  })
})
