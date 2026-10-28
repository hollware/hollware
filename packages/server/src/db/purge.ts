import { newId } from '@hollware/core'

const PURGED = 'EXISTS (SELECT 1 FROM entry_purges WHERE site_id = ?1 AND entry_id = ?2)'

const CHILDREN = [
  `DELETE FROM review_comments WHERE site_id = ?1 AND review_id IN (SELECT id FROM reviews WHERE site_id = ?1 AND entry_id = ?2) AND ${PURGED}`,
  `DELETE FROM reviews WHERE site_id = ?1 AND entry_id = ?2 AND ${PURGED}`,
  `DELETE FROM deliveries WHERE site_id = ?1 AND event_id IN (SELECT id FROM outbox WHERE site_id = ?1 AND entry_id = ?2) AND ${PURGED}`,
  `DELETE FROM outbox WHERE site_id = ?1 AND entry_id = ?2 AND ${PURGED}`,
  `DELETE FROM schedules WHERE site_id = ?1 AND entry_id = ?2 AND ${PURGED}`,
  `DELETE FROM unpublishes WHERE site_id = ?1 AND entry_id = ?2 AND ${PURGED}`,
  `DELETE FROM redirects WHERE site_id = ?1 AND entry_id = ?2 AND ${PURGED}`,
  `DELETE FROM entry_embeddings WHERE site_id = ?1 AND entry_id = ?2 AND ${PURGED}`,
  `DELETE FROM publications WHERE site_id = ?1 AND entry_id = ?2 AND ${PURGED}`,
  `DELETE FROM revision_tags WHERE site_id = ?1 AND revision_id IN (SELECT id FROM revisions WHERE site_id = ?1 AND entry_id = ?2) AND ${PURGED}`,
  `DELETE FROM revisions WHERE site_id = ?1 AND entry_id = ?2 AND ${PURGED}`,
  `DELETE FROM entries WHERE site_id = ?1 AND id = ?2 AND ${PURGED}`,
]

export async function purgeEntry(
  db: D1Database,
  input: {
    readonly site: string
    readonly entryId: string
    readonly purgedBy: string
    readonly now: string
  },
): Promise<'purged' | 'not_found' | 'not_in_trash'> {
  const found = await db
    .prepare('SELECT deleted_at FROM entries WHERE site_id = ?1 AND id = ?2')
    .bind(input.site, input.entryId)
    .first<{ deleted_at: string | null }>()
  if (found === null) return 'not_found'
  const [recorded] = await db.batch([
    db
      .prepare(
        'INSERT INTO entry_purges (id, site_id, entry_id, purged_by, created_at, updated_at) SELECT ?3, ?1, ?2, ?4, ?5, ?5 WHERE EXISTS (SELECT 1 FROM entries WHERE site_id = ?1 AND id = ?2 AND deleted_at IS NOT NULL)',
      )
      .bind(input.site, input.entryId, newId('prg'), input.purgedBy, input.now),
    ...CHILDREN.map((statement) => db.prepare(statement).bind(input.site, input.entryId)),
  ])
  return (recorded?.meta.changes ?? 0) === 1 ? 'purged' : 'not_in_trash'
}
