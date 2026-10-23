import { COMARK_VERSION, PIPELINE_VERSION, type ResolvedSite } from '@hollware/core'
import { processFor } from '../ops/draft.ts'

export const REPARSE_BATCH = 20

interface Stale {
  readonly id: string
  readonly markdown: string
  readonly collection: string
}

export async function reparseRevisions(
  db: D1Database,
  site: ResolvedSite,
  now: string,
  log: (entry: object) => void,
  limit = REPARSE_BATCH,
): Promise<number> {
  const { results } = await db
    .prepare(
      `SELECT r.id AS id, r.markdown AS markdown, e.collection AS collection
         FROM revisions AS r JOIN entries AS e ON e.id = r.entry_id AND e.site_id = r.site_id
        WHERE r.site_id = ?1 AND (r.pipeline_version != ?2 OR r.comark_version != ?3)
        LIMIT ?4`,
    )
    .bind(site.key, PIPELINE_VERSION, COMARK_VERSION, limit)
    .all<Stale>()
  for (const stale of results) {
    const collection = site.collections.get(stale.collection)
    const processed =
      collection === undefined ? null : await processFor(site, collection, stale.markdown)
    if (processed === null || !processed.ok) {
      log({ kind: 'reparse', site: site.key, revisionId: stale.id, outcome: 'kept' })
      await db
        .prepare(
          'UPDATE revisions SET pipeline_version = ?1, comark_version = ?2, updated_at = ?3 WHERE id = ?4 AND site_id = ?5',
        )
        .bind(PIPELINE_VERSION, COMARK_VERSION, now, stale.id, site.key)
        .run()
      continue
    }
    const { value } = processed
    await db
      .prepare(
        `UPDATE revisions SET frontmatter = ?1, document = ?2, word_count = ?3, pipeline_version = ?4,
           comark_version = ?5, updated_at = ?6, code_words = ?9 WHERE id = ?7 AND site_id = ?8`,
      )
      .bind(
        JSON.stringify(value.frontmatter),
        JSON.stringify(value.document),
        value.extracted.words,
        value.pipelineVersion,
        value.comarkVersion,
        now,
        stale.id,
        site.key,
        value.extracted.codeWords,
      )
      .run()
  }
  return results.length
}
