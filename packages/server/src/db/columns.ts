import { newId, type IdPrefix } from '@hollware/core'
import { text } from 'drizzle-orm/sqlite-core'

/**
 * The columns every table shares. Each helper returns a new builder, because a Drizzle column
 * belongs to one table. Only the repository functions write rows, so these defaults are what
 * every row gets.
 */

/** The current time in UTC, as ISO 8601 with milliseconds: `2026-10-12T18:30:00.000Z`. */
export function nowIso(): string {
  return new Date().toISOString()
}

/** The primary key: a prefixed ULID, such as `ent_01JAB3XQ8ZK4M6N2P5R7S9T0VW`. */
export function id(prefix: IdPrefix) {
  return text('id')
    .primaryKey()
    .$defaultFn(() => newId(prefix))
}

/**
 * The site a row belongs to: the site's key, which is also the id of its
 * row in `sites`. Every table but the deployment-wide ones carries it (ADR-006).
 */
export function siteId() {
  return text('site_id').notNull()
}

/** `created_at` and `updated_at`, in UTC; `updated_at` moves on every update. */
export function timestamps() {
  return {
    createdAt: text('created_at').notNull().$defaultFn(nowIso),
    updatedAt: text('updated_at').notNull().$defaultFn(nowIso).$onUpdateFn(nowIso),
  }
}
