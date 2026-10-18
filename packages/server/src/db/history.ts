import type { Verdict } from '@hollware/core'
import { and, desc, eq, or, lt, sql } from 'drizzle-orm'

import type { HistoryRevision } from '../ports.ts'
import type { Db } from './d1.ts'
import { publications, revisions, users } from './schema.ts'

/**
 * The history of an entry (`list_revisions`, `get_revision`): its revisions, newest first, with
 * the name of who wrote each and whether one was ever published. Revisions are append-only
 * (ADR-021), so the history is every one there is.
 */

const COLUMNS = {
  id: revisions.id,
  entryId: revisions.entryId,
  createdAt: revisions.createdAt,
  actorKind: revisions.actorKind,
  actorUserId: revisions.actorUserId,
  actorMeta: revisions.actorMeta,
  frontmatter: revisions.frontmatter,
  wordCount: revisions.wordCount,
  verdict: revisions.verdict,
  authorName: users.name,
  // Whether a publication ever published this revision: one row of `publications` names it.
  published: sql<number>`exists (select 1 from ${publications} where ${and(
    eq(publications.revisionId, revisions.id),
    eq(publications.siteId, revisions.siteId),
    eq(publications.action, 'publish'),
  )})`,
}

type Row = {
  id: string
  entryId: string
  createdAt: string
  actorKind: string
  actorUserId: string
  actorMeta: string | null
  frontmatter: string
  wordCount: number
  verdict: string
  authorName: string | null
  published: number
}

function toHistory(row: Row): HistoryRevision {
  const verdict: Verdict = JSON.parse(row.verdict)
  const meta: Readonly<Record<string, unknown>> | null =
    row.actorMeta === null ? null : JSON.parse(row.actorMeta)
  const frontmatter: Readonly<Record<string, unknown>> = JSON.parse(row.frontmatter)
  return {
    id: row.id,
    entryId: row.entryId,
    createdAt: row.createdAt,
    actorKind:
      row.actorKind === 'token' || row.actorKind === 'oauth_client' ? row.actorKind : 'user',
    actorUserId: row.actorUserId,
    actorMeta: meta,
    authorName: row.authorName,
    frontmatter,
    wordCount: row.wordCount,
    verdict,
    published: row.published === 1,
  }
}

/** A page of the revisions of an entry, newest first, after `cursor` when one is given. */
export async function listRevisions(
  db: Db,
  site: string,
  entryId: string,
  limit: number,
  cursor: { readonly createdAt: string; readonly id: string } | null,
): Promise<readonly HistoryRevision[]> {
  const rows = await db
    .select(COLUMNS)
    .from(revisions)
    .leftJoin(users, eq(users.id, revisions.actorUserId))
    .where(
      and(
        eq(revisions.siteId, site),
        eq(revisions.entryId, entryId),
        cursor === null
          ? undefined
          : or(
              lt(revisions.createdAt, cursor.createdAt),
              and(eq(revisions.createdAt, cursor.createdAt), lt(revisions.id, cursor.id)),
            ),
      ),
    )
    .orderBy(desc(revisions.createdAt), desc(revisions.id))
    .limit(limit)
  return rows.map(toHistory)
}

/** One revision of the site, with its Markdown, or `null`. */
export async function findRevision(
  db: Db,
  site: string,
  id: string,
): Promise<(HistoryRevision & { readonly markdown: string }) | null> {
  const [row] = await db
    .select({ ...COLUMNS, markdown: revisions.markdown })
    .from(revisions)
    .leftJoin(users, eq(users.id, revisions.actorUserId))
    .where(and(eq(revisions.siteId, site), eq(revisions.id, id)))
    .limit(1)
  return row === undefined ? null : { ...toHistory(row), markdown: row.markdown }
}
