import { HollwareError } from '@hollware/core'
import type { EntryFacts, EntryLookup, EntryRef } from '@hollware/core'
import { and, desc, eq, inArray, isNotNull, isNull, or, sql, type SQL } from 'drizzle-orm'

import type {
  EntrySummaryView,
  EntryView,
  ListQuery,
  RelatedEntry,
  SearchHit,
  SearchQuery,
  StoredPublication,
  StoredRevision,
  View,
} from '../ports.ts'
import { chunk, rowsPerStatement } from './chunks.ts'
import { decodeCursor, encodeCursor, type CursorPosition } from './cursor.ts'
import type { Db } from './d1.ts'
import {
  entryFields,
  entryStatus,
  publicationFields,
  revisionFields,
  revisionSummaryFields,
  tagsOf,
  toEntry,
  toPublication,
  toRevision,
  toRevisionSummary,
} from './rows.ts'
import { entries, entryEmbeddings, publications, revisions, revisionTags } from './schema.ts'

const publishedOnly = sql`${entries.status} = 'published'`

function revisionOf(view: View) {
  const revisionId = view === 'head' ? entries.headRev : entries.publishedRev
  return and(eq(revisions.id, revisionId), eq(revisions.siteId, entries.siteId))
}

function viewWhere(view: View, conditions: readonly (SQL | undefined)[], trashed = false) {
  if (view === 'published') return and(...conditions, publishedOnly)
  return and(...conditions, trashed ? isNotNull(entries.deletedAt) : isNull(entries.deletedAt))
}

function viewQuery(db: Db, view: View, conditions: readonly (SQL | undefined)[]) {
  return db
    .select({ entry: entryFields, revision: revisionFields, tags: tagsOf(revisions) })
    .from(entries)
    .innerJoin(revisions, revisionOf(view))
    .where(viewWhere(view, conditions))
}

type ViewRow = Awaited<ReturnType<typeof viewQuery>>[number]

function toEntryView(row: ViewRow): EntryView {
  return { entry: toEntry(row.entry), revision: toRevision(row.revision, row.tags) }
}

function summaryQuery(
  db: Db,
  view: View,
  conditions: readonly (SQL | undefined)[],
  trashed = false,
) {
  return db
    .select({
      entry: entryFields,
      revision: revisionSummaryFields,
      tags: tagsOf(revisions),
      sortKey: entries.publishedSortKey,
    })
    .from(entries)
    .innerJoin(revisions, revisionOf(view))
    .where(viewWhere(view, conditions, trashed))
}

type SummaryRow = Awaited<ReturnType<typeof summaryQuery>>[number]

function toEntrySummaryView(row: SummaryRow): EntrySummaryView {
  return { entry: toEntry(row.entry), revision: toRevisionSummary(row.revision, row.tags) }
}

export async function findEntry(
  db: Db,
  site: string,
  ref: EntryRef,
  view: View,
): Promise<EntryView | null> {
  const [row] = await viewQuery(db, view, [
    eq(entries.siteId, site),
    eq(entries.collection, ref.collection),
    eq(entries.locale, ref.locale),
    eq(entries.slug, ref.slug),
  ]).limit(1)
  return row === undefined ? null : toEntryView(row)
}

export async function findEntryById(
  db: Db,
  site: string,
  id: string,
  view: View,
): Promise<EntryView | null> {
  const [row] = await viewQuery(db, view, [eq(entries.siteId, site), eq(entries.id, id)]).limit(1)
  return row === undefined ? null : toEntryView(row)
}

export async function findRevision(
  db: Db,
  site: string,
  revisionId: string,
): Promise<StoredRevision | null> {
  const [row] = await db
    .select({ revision: revisionFields, tags: tagsOf(revisions) })
    .from(revisions)
    .where(and(eq(revisions.id, revisionId), eq(revisions.siteId, site)))
    .limit(1)
  return row === undefined ? null : toRevision(row.revision, row.tags)
}

function hasTag(site: string, tag: string): SQL {
  return sql`exists (select 1 from ${revisionTags} where ${and(
    eq(revisionTags.revisionId, revisions.id),
    eq(revisionTags.siteId, site),
    eq(revisionTags.tag, tag),
  )})`
}

export function listEntriesQuery(
  db: Db,
  site: string,
  query: ListQuery,
  cursor: CursorPosition | null,
) {
  const sortKey = query.view === 'head' ? entries.updatedAt : entries.publishedSortKey
  return summaryQuery(
    db,
    query.view,
    [
      eq(entries.siteId, site),
      eq(entries.collection, query.collection),
      query.locale === undefined ? undefined : eq(entries.locale, query.locale),
      query.view === 'head' && query.status !== undefined
        ? eq(entries.status, query.status)
        : undefined,
      query.tag === undefined ? undefined : hasTag(site, query.tag),
      cursor === null
        ? undefined
        : sql`(${sortKey}, ${entries.id}) < (${cursor.key}, ${cursor.id})`,
    ],
    query.trashed === true,
  )
    .orderBy(desc(sortKey), desc(entries.id))
    .limit(query.limit + 1)
}

export function ftsQuery(text: string): string {
  const words = text.match(/[\p{L}\p{N}_]+/gu) ?? []
  return words.map((word) => `"${word}"`).join(' ')
}

const BM25 = sql.raw('bm25(entries_fts, 10.0, 4.0, 1.0)')

export async function searchEntries(
  db: Db,
  site: string,
  query: SearchQuery,
): Promise<readonly SearchHit[]> {
  const match = ftsQuery(query.text)
  if (match === '') return []
  const hits = await db.all<{ entry_id: string; snippet: string; rank: number }>(sql`
    select entry_id, snippet(entries_fts, 2, '[', ']', '…', 16) as snippet, ${BM25} as rank
    from entries_fts
    where entries_fts match ${match} and site_id = ${site}
      ${query.collection === undefined ? sql`` : sql`and collection = ${query.collection}`}
      ${query.locale === undefined ? sql`` : sql`and locale = ${query.locale}`}
    order by rank
    limit ${query.limit}
  `)
  if (hits.length === 0) return []
  const rows = await summaryQuery(db, 'published', [
    eq(entries.siteId, site),
    inArray(
      entries.id,
      hits.map((hit) => hit.entry_id),
    ),
  ])
  const byId = new Map(rows.map((row) => [row.entry.id, toEntrySummaryView(row)]))
  return hits.flatMap((hit) => {
    const entry = byId.get(hit.entry_id)
    return entry === undefined ? [] : [{ entry, snippet: hit.snippet, score: -hit.rank }]
  })
}

export async function findSummaries(
  db: Db,
  site: string,
  ids: readonly string[],
  view: View,
): Promise<readonly EntrySummaryView[]> {
  if (ids.length === 0) return []
  const rows = await summaryQuery(db, view, [
    eq(entries.siteId, site),
    inArray(entries.id, [...ids]),
  ])
  const byId = new Map(rows.map((row) => [row.entry.id, toEntrySummaryView(row)]))
  return ids.flatMap((id) => {
    const entry = byId.get(id)
    return entry === undefined ? [] : [entry]
  })
}

export async function relatedOf(
  db: Db,
  site: string,
  entryId: string,
): Promise<readonly RelatedEntry[]> {
  const [row] = await db
    .select({ related: entryEmbeddings.related })
    .from(entryEmbeddings)
    .where(and(eq(entryEmbeddings.siteId, site), eq(entryEmbeddings.entryId, entryId)))
    .limit(1)
  if (row === undefined) return []
  const parsed: unknown = JSON.parse(row.related)
  if (!Array.isArray(parsed)) return []
  return parsed.flatMap((item: unknown) =>
    typeof item === 'object' &&
    item !== null &&
    'id' in item &&
    'score' in item &&
    typeof item.id === 'string' &&
    typeof item.score === 'number'
      ? [{ id: item.id, score: item.score }]
      : [],
  )
}

export async function listEntries(
  db: Db,
  site: string,
  query: ListQuery,
): Promise<{ readonly entries: readonly EntrySummaryView[]; readonly nextCursor: string | null }> {
  if (!Number.isInteger(query.limit) || query.limit < 1) {
    throw new HollwareError(
      'invalid_input',
      `The limit ${query.limit} is not a whole number of at least 1.`,
      'Ask for at least one entry per page.',
    )
  }
  const cursor = query.cursor === undefined ? null : decodeCursor(query.cursor, query.view)
  if (
    query.view === 'published' &&
    (query.trashed === true || (query.status !== undefined && query.status !== 'published'))
  ) {
    return { entries: [], nextCursor: null }
  }
  const rows = await listEntriesQuery(db, site, query, cursor)
  const page = rows.slice(0, query.limit)
  const last = page.at(-1)
  if (last === undefined || rows.length === page.length) {
    return { entries: page.map(toEntrySummaryView), nextCursor: null }
  }
  const key = query.view === 'head' ? last.entry.updatedAt : last.sortKey
  if (key === null) {
    throw new Error(`The published entry ${last.entry.id} has no published_sort_key`)
  }
  return {
    entries: page.map(toEntrySummaryView),
    nextCursor: encodeCursor(query.view, { key, id: last.entry.id }),
  }
}

export function listTranslationsQuery(
  db: Db,
  site: string,
  collection: string,
  translationGroup: string,
  view: View,
) {
  return summaryQuery(db, view, [
    eq(entries.siteId, site),
    eq(entries.collection, collection),
    eq(entries.translationGroup, translationGroup),
  ]).orderBy(entries.locale)
}

export async function listTranslations(
  db: Db,
  site: string,
  collection: string,
  translationGroup: string,
  view: View,
): Promise<readonly EntrySummaryView[]> {
  const rows = await listTranslationsQuery(db, site, collection, translationGroup, view)
  return rows.map(toEntrySummaryView)
}

export async function lastPublication(
  db: Db,
  site: string,
  entryId: string,
): Promise<StoredPublication | null> {
  const [row] = await db
    .select(publicationFields)
    .from(publications)
    .where(and(eq(publications.siteId, site), eq(publications.entryId, entryId)))
    .orderBy(desc(publications.createdAt), sql`${publications}.rowid desc`)
    .limit(1)
  return row === undefined ? null : toPublication(row)
}

const factFields = {
  id: entries.id,
  collection: entries.collection,
  locale: entries.locale,
  slug: entries.slug,
  status: entries.status,
  translationGroup: entries.translationGroup,
}

function refKey(ref: EntryRef): string {
  return JSON.stringify([ref.collection, ref.locale, ref.slug])
}

function refMatches(ref: EntryRef): SQL | undefined {
  return and(
    eq(entries.collection, ref.collection),
    eq(entries.locale, ref.locale),
    eq(entries.slug, ref.slug),
  )
}

export function lookup(db: Db, site: string): EntryLookup {
  return {
    async lookupMany(refs) {
      const distinct = new Map(refs.map((ref) => [refKey(ref), ref]))
      const [first, ...rest] = chunk([...distinct.values()], rowsPerStatement(1, 3)).map((group) =>
        db
          .select(factFields)
          .from(entries)
          .where(
            and(eq(entries.siteId, site), isNull(entries.deletedAt), or(...group.map(refMatches))),
          ),
      )
      if (first === undefined) return []
      const found = new Map<string, EntryFacts>()
      for (const row of (await db.batch([first, ...rest])).flat()) {
        found.set(refKey(row), {
          id: row.id,
          status: entryStatus(row.status),
          translationGroup: row.translationGroup,
        })
      }
      return refs.map((ref) => found.get(refKey(ref)) ?? null)
    },
    async translations(collection, translationGroup) {
      const rows = await db
        .select(factFields)
        .from(entries)
        .where(
          and(
            eq(entries.siteId, site),
            eq(entries.collection, collection),
            eq(entries.translationGroup, translationGroup),
            isNull(entries.deletedAt),
          ),
        )
        .orderBy(entries.locale)
      return rows.map((row) => ({
        collection: row.collection,
        locale: row.locale,
        slug: row.slug,
        id: row.id,
        status: entryStatus(row.status),
        translationGroup: row.translationGroup,
      }))
    },
  }
}
