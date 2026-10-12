import { and, eq, sql } from 'drizzle-orm'
import type { DrizzleD1Database } from 'drizzle-orm/d1'
import { entries, revisions } from './schema.ts'

export interface RevisionWrite {
  entryId: string
  /** The entry version the caller read. The write only lands while the entry still has it. */
  expectedVersion: number
  revisionId: string
  markdown: string
  createdAt: string
}

export type WriteOutcome = { outcome: 'written'; version: number } | { outcome: 'conflict' }

/**
 * The two statements of the optimistic write, as drizzle builders. Order matters: the INSERT
 * must run before the UPDATE bumps the version it checks.
 *
 * `insert().select()` takes every column of the table, in the order of the table definition
 * (drizzle-orm sqlite-core/query-builders/insert.js: `haveSameKeys`), so the selected object
 * lists all four columns of `revisions` even though only `entry_id` comes from a table. A
 * computed value needs `.as()`: `BuildSubquerySelection` (select.types.d.ts) turns an
 * un-aliased `sql` field into a type error. The aliases are cosmetic (the INSERT matches
 * columns by position). They differ from the `entries` column names so that the bare "id" the
 * builder renders for `entries.id` cannot be mistaken for an alias; with an alias `id` SQLite
 * still picked the table column here, but that is not worth relying on.
 */
export function revisionWriteStatements(db: DrizzleD1Database, write: RevisionWrite) {
  const stillAtExpectedVersion = and(
    eq(entries.id, write.entryId),
    eq(entries.version, write.expectedVersion),
  )

  const insertRevision = db.insert(revisions).select((qb) =>
    qb
      .select({
        id: sql<string>`${write.revisionId}`.as('rev_id'),
        entryId: entries.id,
        markdown: sql<string>`${write.markdown}`.as('rev_markdown'),
        createdAt: sql<string>`${write.createdAt}`.as('rev_created_at'),
      })
      .from(entries)
      .where(stillAtExpectedVersion),
  )

  const bumpVersion = db
    .update(entries)
    .set({ version: sql`${entries.version} + 1`, headRev: write.revisionId })
    .where(stillAtExpectedVersion)
    .returning({ version: entries.version })

  return [insertRevision, bumpVersion] as const
}

/** The optimistic write through drizzle: one `db.batch`, an empty RETURNING means conflict. */
export async function writeRevision(
  db: DrizzleD1Database,
  write: RevisionWrite,
): Promise<WriteOutcome> {
  const [, bumped] = await db.batch(revisionWriteStatements(db, write))
  const [row] = bumped
  return row === undefined ? { outcome: 'conflict' } : { outcome: 'written', version: row.version }
}

/** The same write without drizzle: raw prepared statements in one `D1Database.batch`. */
export async function writeRevisionRaw(
  d1: D1Database,
  write: RevisionWrite,
): Promise<WriteOutcome> {
  const [, bumped] = await d1.batch<{ version: number }>([
    d1
      .prepare(
        'INSERT INTO revisions (id, entry_id, markdown, created_at) ' +
          'SELECT ?, id, ?, ? FROM entries WHERE id = ? AND version = ?',
      )
      .bind(
        write.revisionId,
        write.markdown,
        write.createdAt,
        write.entryId,
        write.expectedVersion,
      ),
    d1
      .prepare(
        'UPDATE entries SET version = version + 1, head_rev = ? ' +
          'WHERE id = ? AND version = ? RETURNING version',
      )
      .bind(write.revisionId, write.entryId, write.expectedVersion),
  ])
  const row = bumped?.results[0]
  return row === undefined ? { outcome: 'conflict' } : { outcome: 'written', version: row.version }
}
