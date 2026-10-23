import type { Verdict } from '@hollware/core'
import { and, desc, eq, inArray, isNull, or, lt, sql } from 'drizzle-orm'

import type { HistoryRevision } from '../ports.ts'
import type { Db } from './d1.ts'
import { entries, publications, revisions, users } from './schema.ts'

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

export async function sourceHeadTimes(
  db: Db,
  site: string,
  sourceLocale: string,
  pairs: readonly { readonly collection: string; readonly group: string }[],
): Promise<ReadonlyMap<string, { readonly first: string; readonly head: string }>> {
  const times = new Map<string, { readonly first: string; readonly head: string }>()
  if (pairs.length === 0) return times
  const wanted = new Set(pairs.map((pair) => `${pair.collection}\0${pair.group}`))
  const rows = await db
    .select({
      collection: entries.collection,
      group: entries.translationGroup,
      createdAt: revisions.createdAt,
      firstAt: sql<string>`(select min(r.created_at) from ${revisions} as r where r.entry_id = ${entries.id} and r.site_id = ${entries.siteId})`,
    })
    .from(entries)
    .innerJoin(
      revisions,
      and(eq(revisions.id, entries.headRev), eq(revisions.siteId, entries.siteId)),
    )
    .where(
      and(
        eq(entries.siteId, site),
        eq(entries.locale, sourceLocale),
        isNull(entries.deletedAt),
        inArray(entries.translationGroup, [...new Set(pairs.map((pair) => pair.group))]),
      ),
    )
  for (const row of rows) {
    const key = `${row.collection}\0${row.group ?? ''}`
    if (wanted.has(key)) times.set(key, { first: row.firstAt, head: row.createdAt })
  }
  return times
}

export async function revisionTimes(
  db: Db,
  site: string,
  ids: readonly string[],
): Promise<ReadonlyMap<string, string>> {
  if (ids.length === 0) return new Map()
  const rows = await db
    .select({ id: revisions.id, createdAt: revisions.createdAt })
    .from(revisions)
    .where(and(eq(revisions.siteId, site), inArray(revisions.id, [...new Set(ids)])))
  return new Map(rows.map((row) => [row.id, row.createdAt]))
}
