import { newId } from '@hollware/core'
import type { D1Like } from '../db/d1.ts'
import type { StructureActor, StructureStore } from '../ports.ts'

/**
 * The structure of the sites on D1 (ADR-033). Each change is one batch: the row of `sites`, moved
 * only if it is where the caller saw it, and its line of `site_changes`, written only if the row
 * moved, at the version it moved to.
 */

function metaOf(actor: StructureActor): string | null {
  return actor.meta === null ? null : JSON.stringify(actor.meta)
}

/** The change a statement before it made, at the site's version now, if that version is new. */
function appendChange(
  db: D1Like,
  site: string,
  actor: StructureActor,
  now: string,
  before: string | null,
  after: 'definition' | 'null',
): D1PreparedStatement {
  return db
    .prepare(
      `INSERT OR IGNORE INTO site_changes (id, site_id, version, actor_user_id, actor_meta, before, after, created_at, updated_at)
       SELECT ?1, id, version, ?2, ?3, ?4, ${after === 'definition' ? 'definition' : 'NULL'}, ?5, ?5 FROM sites WHERE id = ?6 AND updated_at = ?5`,
    )
    .bind(newId('sit'), actor.userId, metaOf(actor), before, now, site)
}

export function createStructureStore(db: D1Like, now: () => Date): StructureStore {
  return {
    async read(site) {
      const row = await db
        .prepare('SELECT version, definition, deleted_at FROM sites WHERE id = ?1')
        .bind(site)
        .first<{ version: number; definition: string | null; deleted_at: string | null }>()
      if (row === null || row.definition === null) return null
      return {
        version: row.version,
        definition: JSON.parse(row.definition) as unknown,
        deletedAt: row.deleted_at,
      }
    },

    async write({ site, expected, definition, actor }) {
      const at = now().toISOString()
      const before = await db
        .prepare('SELECT definition FROM sites WHERE id = ?1')
        .bind(site)
        .first<string | null>('definition')
      const [moved] = await db.batch([
        db
          .prepare(
            'UPDATE sites SET definition = ?1, version = version + 1, updated_at = ?2 WHERE id = ?3 AND version = ?4 AND deleted_at IS NULL',
          )
          .bind(JSON.stringify(definition), at, site, expected),
        appendChange(db, site, actor, at, before ?? null, 'definition'),
      ])
      return (moved?.meta.changes ?? 0) === 1 ? 'written' : 'conflict'
    },

    async create({ site, definition, actor }) {
      const at = now().toISOString()
      const [made] = await db.batch([
        db
          .prepare(
            'INSERT INTO sites (id, definition, version, created_at, updated_at) VALUES (?1, ?2, 1, ?3, ?3) ON CONFLICT (id) DO NOTHING',
          )
          .bind(site, JSON.stringify(definition), at),
        db
          .prepare(
            `INSERT INTO members (id, site_id, user_id, role, created_at, updated_at)
             SELECT ?1, ?2, ?3, 'owner', ?4, ?4 WHERE EXISTS (SELECT 1 FROM sites WHERE id = ?2 AND created_at = ?4 AND version = 1)
             ON CONFLICT (site_id, user_id) DO NOTHING`,
          )
          .bind(newId('mbr'), site, actor.userId, at),
        appendChange(db, site, actor, at, null, 'definition'),
      ])
      return (made?.meta.changes ?? 0) === 1 ? 'created' : 'taken'
    },

    async trash(site, actor) {
      const at = now().toISOString()
      const before = await db
        .prepare('SELECT definition FROM sites WHERE id = ?1')
        .bind(site)
        .first<string | null>('definition')
      const [moved] = await db.batch([
        db
          .prepare(
            'UPDATE sites SET deleted_at = ?1, version = version + 1, updated_at = ?1 WHERE id = ?2 AND deleted_at IS NULL AND definition IS NOT NULL',
          )
          .bind(at, site),
        appendChange(db, site, actor, at, before ?? null, 'null'),
      ])
      return (moved?.meta.changes ?? 0) === 1
    },

    async restore(site, actor) {
      const at = now().toISOString()
      const [moved] = await db.batch([
        db
          .prepare(
            'UPDATE sites SET deleted_at = NULL, version = version + 1, updated_at = ?1 WHERE id = ?2 AND deleted_at IS NOT NULL',
          )
          .bind(at, site),
        appendChange(db, site, actor, at, null, 'definition'),
      ])
      return (moved?.meta.changes ?? 0) === 1
    },

    async roleOf(site, userId) {
      const role = await db
        .prepare('SELECT role FROM members WHERE site_id = ?1 AND user_id = ?2')
        .bind(site, userId)
        .first<string>('role')
      return role === 'owner' || role === 'editor' || role === 'author' ? role : null
    },

    async counts(site) {
      const [collections, locales] = await db.batch<{ key: string; n: number }>([
        db
          .prepare(
            'SELECT collection AS key, count(*) AS n FROM entries WHERE site_id = ?1 GROUP BY collection',
          )
          .bind(site),
        db
          .prepare(
            'SELECT locale AS key, count(*) AS n FROM entries WHERE site_id = ?1 GROUP BY locale',
          )
          .bind(site),
      ])
      const mapOf = (rows: readonly { key: string; n: number }[] | undefined) =>
        new Map((rows ?? []).map((row) => [row.key, row.n]))
      return { byCollection: mapOf(collections?.results), byLocale: mapOf(locales?.results) }
    },

    async frontmatters(site, collection, limit) {
      const { results } = await db
        .prepare(
          `SELECT e.slug AS slug, r.frontmatter AS frontmatter FROM entries e
           JOIN revisions r ON r.id = e.head_rev AND r.site_id = e.site_id
           WHERE e.site_id = ?1 AND e.collection = ?2 ORDER BY e.slug LIMIT ?3`,
        )
        .bind(site, collection, limit)
        .all<{ slug: string; frontmatter: string }>()
      return results.map((row) => ({
        slug: row.slug,
        frontmatter: JSON.parse(row.frontmatter) as unknown,
      }))
    },
  }
}

/** The sealed secrets of the structure of a site (ADR-033), by name. */
export function createSecretStore(db: D1Like, now: () => Date) {
  return {
    async read(site: string, name: string): Promise<string | null> {
      return db
        .prepare('SELECT sealed FROM site_secrets WHERE site_id = ?1 AND name = ?2')
        .bind(site, name)
        .first<string>('sealed')
    },
    async write(site: string, name: string, sealed: string): Promise<void> {
      const at = now().toISOString()
      await db
        .prepare(
          `INSERT INTO site_secrets (id, site_id, name, sealed, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, ?5, ?5)
           ON CONFLICT (site_id, name) DO UPDATE SET sealed = excluded.sealed, updated_at = excluded.updated_at`,
        )
        .bind(newId('sec'), site, name, sealed, at)
        .run()
    },
  }
}
