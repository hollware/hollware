import { newId } from '@hollware/core'

export const PRESENT_FOR_MS = 45_000
export const FORGOTTEN_AFTER_MS = 120_000

export interface Editor {
  readonly id: string
  readonly name: string | null
  readonly kind: 'person' | 'agent'
}

export interface PresencePlace {
  readonly site: string
  readonly entryId: string
  readonly userId: string
}

function editorOf(row: Record<string, unknown>): Editor {
  return {
    id: String(row['id']),
    name: typeof row['name'] === 'string' ? row['name'] : null,
    kind: row['kind'] === 'agent' ? 'agent' : 'person',
  }
}

export async function touchPresence(
  db: D1Database,
  place: PresencePlace,
  now: Date,
): Promise<Editor[]> {
  const seen = now.toISOString()
  const forgotten = new Date(now.getTime() - FORGOTTEN_AFTER_MS).toISOString()
  const present = new Date(now.getTime() - PRESENT_FOR_MS).toISOString()
  const [, , others] = await db.batch([
    db
      .prepare(
        `INSERT INTO presence (id, site_id, entry_id, user_id, seen_at, created_at, updated_at)
          VALUES (?5, ?1, ?2, ?3, ?4, ?4, ?4)
          ON CONFLICT (site_id, entry_id, user_id)
          DO UPDATE SET seen_at = excluded.seen_at, updated_at = excluded.updated_at`,
      )
      .bind(place.site, place.entryId, place.userId, seen, newId('prs')),
    db
      .prepare('DELETE FROM presence WHERE site_id = ?1 AND entry_id = ?2 AND seen_at < ?3')
      .bind(place.site, place.entryId, forgotten),
    db
      .prepare(
        `SELECT users.id AS id, users.name AS name, users.kind AS kind FROM presence
          JOIN users ON users.id = presence.user_id
          WHERE presence.site_id = ?1 AND presence.entry_id = ?2 AND presence.user_id <> ?3
            AND presence.seen_at >= ?4
          ORDER BY presence.seen_at DESC`,
      )
      .bind(place.site, place.entryId, place.userId, present),
  ])
  return (others?.results ?? []).map((row) => editorOf(row as Record<string, unknown>))
}

export async function leavePresence(db: D1Database, place: PresencePlace): Promise<void> {
  await db
    .prepare('DELETE FROM presence WHERE site_id = ?1 AND entry_id = ?2 AND user_id = ?3')
    .bind(place.site, place.entryId, place.userId)
    .run()
}

export async function editorById(db: D1Database, userId: string): Promise<Editor | null> {
  const row = await db
    .prepare('SELECT id, name, kind FROM users WHERE id = ?1')
    .bind(userId)
    .first<Record<string, unknown>>()
  return row === null ? null : editorOf(row)
}
