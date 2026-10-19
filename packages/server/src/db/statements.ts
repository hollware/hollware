import { newId } from '@hollware/core'
import type { AcknowledgedWarning, Verdict } from '@hollware/core'
import { and, eq, getTableColumns, sql, type SQL } from 'drizzle-orm'
import type { SQLiteTable } from 'drizzle-orm/sqlite-core'

import type { Actor, NewRevision } from '../ports.ts'
import { chunk, rowsPerStatement } from './chunks.ts'
import type { Db } from './d1.ts'
import { entries, publications, revisions, revisionTags } from './schema.ts'

/**
 * The statements of the writes, built here and run by `writes.ts` in one `db.batch`: D1 runs a
 * batch as one transaction and has no `db.transaction()`. A row a statement inserts is only
 * inserted when the row it depends on is there (ADR-021), so a write that lost its race inserts
 * nothing, and the loss reads as a `conflict` instead of a foreign key error.
 */

/** A revision as `revisions` stores it: every column, the JSON ones as text. */
export type RevisionRow = typeof revisions.$inferSelect

/** A publication as `publications` stores it. */
export type PublicationRow = typeof publications.$inferSelect

export function actorColumns(actor: Actor) {
  return {
    actorKind: actor.kind,
    actorUserId: actor.userId,
    actorTokenId: actor.tokenId,
    actorMeta: actor.meta === null ? null : JSON.stringify(actor.meta),
  }
}

/** The tags of a revision as written: each once, sorted, so that a revision always reads the same. */
export function distinctTags(tags: readonly string[]): string[] {
  return [...new Set(tags)].toSorted()
}

export function revisionRow(input: {
  readonly id: string
  readonly site: string
  readonly entryId: string
  readonly now: string
  readonly revision: NewRevision
}): RevisionRow {
  const { revision } = input
  return {
    id: input.id,
    siteId: input.site,
    entryId: input.entryId,
    markdown: revision.markdown,
    frontmatter: JSON.stringify(revision.frontmatter),
    document: JSON.stringify(revision.document),
    comarkVersion: revision.comarkVersion,
    pipelineVersion: revision.pipelineVersion,
    wordCount: revision.wordCount,
    codeWords: revision.codeWords,
    verdict: JSON.stringify(revision.verdict),
    ...actorColumns(revision.actor),
    createdAt: input.now,
    updatedAt: input.now,
  }
}

export function publicationRow(input: {
  readonly site: string
  readonly entryId: string
  readonly now: string
  readonly actor: Actor
  /** `null` for an unpublish, which has no revision and no verdict. */
  readonly publish: {
    readonly revisionId: string
    readonly verdict: Verdict
    readonly acknowledged: readonly AcknowledgedWarning[]
  } | null
}): PublicationRow {
  return {
    id: newId('pub'),
    siteId: input.site,
    entryId: input.entryId,
    action: input.publish === null ? 'unpublish' : 'publish',
    revisionId: input.publish?.revisionId ?? null,
    verdict: input.publish === null ? null : JSON.stringify(input.publish.verdict),
    acknowledged: JSON.stringify(input.publish?.acknowledged ?? []),
    ...actorColumns(input.actor),
    createdAt: input.now,
    updatedAt: input.now,
  }
}

/**
 * The values of a row in the order of the table's columns, for `insert into t select …`: the
 * insert lists every column of the table, so the select has to give them all, and a column that
 * the row lacks fails here instead of shifting the ones after it. A value may be a column or any
 * SQL, for what only the database knows.
 */
export function valuesOf(table: SQLiteTable, row: Readonly<Record<string, unknown>>): SQL {
  const values = Object.keys(getTableColumns(table)).map((field) => {
    const value = row[field]
    if (value === undefined) throw new Error(`The row has no value for the column ${field}`)
    return sql`${value}`
  })
  return sql.join(values, sql`, `)
}

/** Inserts the revision of an entry only if the entry is still at `version`. */
export function insertRevisionAtVersion(db: Db, row: RevisionRow, version: number) {
  return db
    .insert(revisions)
    .select(
      sql`select ${valuesOf(revisions, row)} from ${entries} where ${and(
        eq(entries.id, row.entryId),
        eq(entries.siteId, row.siteId),
        eq(entries.version, version),
      )}`,
    )
}

/**
 * Inserts the tags of a revision, in as many statements as D1's limit of bound values needs, and
 * only where the revision is there: a tag whose revision was never inserted would fail the
 * foreign key and turn a conflict into a database error. Each tag binds its id and its text;
 * the site, the revision and the time are bound once, and the existence check binds two more.
 * The tags are a `VALUES` list: D1 allows a compound `SELECT` only five terms long, so a
 * `UNION ALL` of tags would fail from the sixth.
 */
export function insertTags(
  db: Db,
  input: { site: string; revisionId: string; tags: readonly string[]; now: string },
) {
  const perStatement = rowsPerStatement(6, 2)
  return chunk(input.tags, perStatement).map((tags) => {
    const rows = tags.map((tag) => sql`(${newId('tag')}, ${tag})`)
    return db
      .insert(revisionTags)
      .select(
        sql`with "t" ("id", "tag") as (values ${sql.join(rows, sql`, `)}) select "t"."id", ${input.site}, ${input.revisionId}, "t"."tag", ${input.now}, ${input.now} from "t" where exists (select 1 from ${revisions} where ${and(
          eq(revisions.id, input.revisionId),
          eq(revisions.siteId, input.site),
        )})`,
      )
  })
}

/**
 * Appends a publication that publishes the head revision of an entry that is still at `version`.
 * The revision is whatever `head_rev` is when the statement runs.
 */
export function insertPublishAtVersion(db: Db, row: PublicationRow, version: number) {
  return db
    .insert(publications)
    .select(
      sql`select ${valuesOf(publications, { ...row, revisionId: entries.headRev })} from ${entries} where ${and(
        eq(entries.id, row.entryId),
        eq(entries.siteId, row.siteId),
        eq(entries.version, version),
      )}`,
    )
}

/** Appends an unpublish, only if the entry is published when the statement runs. */
export function insertUnpublishIfPublished(db: Db, row: PublicationRow) {
  return db
    .insert(publications)
    .select(
      sql`select ${valuesOf(publications, row)} from ${entries} where ${and(
        eq(entries.id, row.entryId),
        eq(entries.siteId, row.siteId),
        eq(entries.status, 'published'),
      )}`,
    )
}
