import { env } from 'cloudflare:workers'
import { describe, expect, it } from 'vitest'

import { connect } from '../../src/db/d1.ts'
import { approvePendingReview, cancelPendingReview } from '../../src/db/reviews.ts'

const NOW = '2026-10-13T10:00:00.000Z'

async function planOf(query: { toSQL(): { sql: string; params: unknown[] } }) {
  const { sql, params } = query.toSQL()
  const { results } = await env.DB.prepare(`EXPLAIN QUERY PLAN ${sql}`)
    .bind(...params)
    .all<{ detail: string }>()
  return results.map((row) => row.detail)
}

describe('the statements that close the review of an entry', () => {
  it('find the review by the active item of the entry, through the partial index of active items', async () => {
    const db = connect(env.DB)
    const access = 'SEARCH review_items USING INDEX review_items_active (site_id=? AND entry_id=?)'

    expect(await planOf(cancelPendingReview(db, 'plans', 'ent_a', 1, NOW))).toContain(access)
    expect(await planOf(approvePendingReview(db, 'plans', 'ent_a', 1, 'usr_a', NOW))).toContain(
      access,
    )
  })
})
