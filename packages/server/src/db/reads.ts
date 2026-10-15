import { HollwareError } from '@hollware/core'
import type { EntryFacts, EntryLookup, EntryRef } from '@hollware/core'
import { and, desc, eq, inArray, or, sql, type SQL } from 'drizzle-orm'

import type {
  EntrySummaryView,
  EntryView,
  ListQuery,
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
import { entries, publications, revisions, revisionTags } from './schema.ts'

/**
 * The reads of the store. Every query carries the `site_id` of the site it was asked for, so a
 * natural key, an id or a translation group of another site finds nothing.
 */

/**
 * Whether an entry is published, as the partial index of published listings says it
 * (`entries_published` covers `status = 'published'`). It is a literal and not a bound value:
 * the index serves a query that says what the index says, and SQLite can tell that of a `?` only
 * by looking at the value bound to it when it plans, which is for the engine to do or not.
 */
const publishedOnly = sql`${entries.status} = 'published'`

/** How an entry reaches the revision of a view: the head revision, or the published one. */
function revisionOf(view: View) {
  const revisionId = view === 'head' ? entries.headRev : entries.publishedRev
  return and(eq(revisions.id, revisionId), eq(revisions.siteId, entries.siteId))
}

/** What picks the entries of a view: the caller's conditions, and in the published view only published ones. */
function viewWhere(view: View, conditions: readonly (SQL | undefined)[]) {
  return and(...conditions, view === 'published' ? publishedOnly : undefined)
}

/**
 * The entries of a site with the whole revision of a view, for the reads of one entry. The caller
 * adds the conditions that pick the entries and what limits them.
 */
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

/**
 * The entries of a site with a summary of the revision of a view, for listings: the entry, and of
 * the revision only its id, its frontmatter and its tags. The sort key of the published view
 * comes along for the cursor.
 */
function summaryQuery(db: Db, view: View, conditions: readonly (SQL | undefined)[]) {
  return db
    .select({
      entry: entryFields,
      revision: revisionSummaryFields,
      tags: tagsOf(revisions),
      sortKey: entries.publishedSortKey,
    })
    .from(entries)
    .innerJoin(revisions, revisionOf(view))
    .where(viewWhere(view, conditions))
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

/** A revision of the site by its id, with its tags: what a publish answers with. */
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

/** Whether the revision a view joined has the tag. */
function hasTag(site: string, tag: string): SQL {
  return sql`exists (select 1 from ${revisionTags} where ${and(
    eq(revisionTags.revisionId, revisions.id),
    eq(revisionTags.siteId, site),
    eq(revisionTags.tag, tag),
  )})`
}

/**
 * The statement of a page of a listing: the entries newest first by the sort key of the view and
 * then by id, after the position of a cursor if there is one, and one more than the page holds,
 * which only tells whether there is a next page.
 *
 * It is shaped for the indexes of `entries`, so that a page costs its own rows and not a sort of
 * the collection (`tests/db/list-plans.workerd.test.ts` reads the plans). The head view reads
 * `entries_head`, or `entries_head_locale` when it names a locale. The published view of a locale
 * reads the partial `entries_published`, whose status is the literal the index says. The cursor
 * is a row value, `(sort key, id) < (?, ?)`, which the index seeks to; the same condition written
 * with `OR` is read from the first row of the collection. The published view with no locale
 * named is the exception: the index has the locale before the sort key, so SQLite sorts the
 * published entries of the collection.
 */
export function listEntriesQuery(
  db: Db,
  site: string,
  query: ListQuery,
  cursor: CursorPosition | null,
) {
  const sortKey = query.view === 'head' ? entries.updatedAt : entries.publishedSortKey
  return summaryQuery(db, query.view, [
    eq(entries.siteId, site),
    eq(entries.collection, query.collection),
    query.locale === undefined ? undefined : eq(entries.locale, query.locale),
    // The published view holds published entries only, which `viewWhere` already says.
    query.view === 'head' && query.status !== undefined
      ? eq(entries.status, query.status)
      : undefined,
    query.tag === undefined ? undefined : hasTag(site, query.tag),
    cursor === null ? undefined : sql`(${sortKey}, ${entries.id}) < (${cursor.key}, ${cursor.id})`,
  ])
    .orderBy(desc(sortKey), desc(entries.id))
    .limit(query.limit + 1)
}

/**
 * The FTS5 query of what someone typed: each of its words as a quoted string, so that FTS5's own
 * syntax (`AND`, `NEAR`, `*`, quotes) is never read from it, and every word must match. Empty when
 * it holds no word.
 */
export function ftsQuery(text: string): string {
  const words = text.match(/[\p{L}\p{N}_]+/gu) ?? []
  return words.map((word) => `"${word}"`).join(' ')
}

/** The weights of the columns of `entries_fts` in bm25: title, tags, then the text. */
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
    // bm25 is lower for a better match; the answer says higher.
    return entry === undefined ? [] : [{ entry, snippet: hit.snippet, score: -hit.rank }]
  })
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
  // The published view lists published entries only: any other status asks for none.
  if (query.view === 'published' && query.status !== undefined && query.status !== 'published') {
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
    // The checks of `entries` require a sort key of a published entry: a database that has none
    // is corrupt, and a page that skipped its entries would hide it.
    throw new Error(`The published entry ${last.entry.id} has no published_sort_key`)
  }
  return {
    entries: page.map(toEntrySummaryView),
    nextCursor: encodeCursor(query.view, { key, id: last.entry.id }),
  }
}

/**
 * The statement of the entries of a translation group: the unique key of the group ends in the
 * locale, so the index gives them in order of locale with no sort.
 */
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

/**
 * The latest publish or unpublish of an entry. Rows are never deleted, so the insertion order
 * (`rowid`) breaks a tie between two written in the same millisecond.
 */
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

/** What cross-entry contracts read, scoped to one site. */
export function lookup(db: Db, site: string): EntryLookup {
  return {
    /**
     * One query per chunk of refs, in one batch: each ref binds three values and the site one
     * more, under D1's limit of bound values. A ref asked twice is asked once.
     */
    async lookupMany(refs) {
      const distinct = new Map(refs.map((ref) => [refKey(ref), ref]))
      const [first, ...rest] = chunk([...distinct.values()], rowsPerStatement(1, 3)).map((group) =>
        db
          .select(factFields)
          .from(entries)
          .where(and(eq(entries.siteId, site), or(...group.map(refMatches)))),
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
