import { COMARK_VERSION, PIPELINE_VERSION, type ResolvedSite } from '@hollware/core'
import { processFor } from '../ops/draft.ts'

/** How many revisions one run rebuilds: a few milliseconds of CPU each (`vp run bench`). */
export const REPARSE_BATCH = 20

interface Stale {
  readonly id: string
  readonly markdown: string
  readonly collection: string
}

/**
 * Rebuilds the derived columns of the revisions of a site that an older Comark or pipeline
 * parsed (ADR-021): the frontmatter, the document and the word count, from the Markdown each keeps
 * byte for byte, and the versions that made them. The cron runs it each minute, a batch at a time,
 * so a release that changes what the same Markdown gives (a new PIPELINE_VERSION) reaches every
 * revision without a command. A revision the pipeline now refuses, or of a collection the site
 * no longer has, keeps its document and takes the versions, so it is not tried again each minute;
 * the log says which. Answers how many revisions it looked at.
 */
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
           comark_version = ?5, updated_at = ?6 WHERE id = ?7 AND site_id = ?8`,
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
      )
      .run()
  }
  return results.length
}
