import { newId } from '@hollware/core'
import type { AcknowledgedWarning, EntryRef, Verdict } from '@hollware/core'
import { and, eq, ne, or, sql } from 'drizzle-orm'
import { alias } from 'drizzle-orm/sqlite-core'

import type {
  Actor,
  Clock,
  EntryView,
  NewRevision,
  StoredRevision,
  WriteRefusal,
} from '../ports.ts'
import type { Db } from './d1.ts'
import { isUniqueViolation } from './errors.ts'
import { findEntryById, findRevision } from './reads.ts'
import { entryFields, toEntry } from './rows.ts'
import { entries, revisions } from './schema.ts'
import { tooLarge } from './size.ts'
import {
  distinctTags,
  insertPublishAtVersion,
  insertRevisionAtVersion,
  insertTags,
  insertUnpublishIfPublished,
  publicationRow,
  revisionRow,
} from './statements.ts'

/**
 * The writes of the store. Each one is a single `db.batch` (a transaction: all of it or none of
 * it), where a revision or a publication is inserted `WHERE` the entry is still at the version
 * the caller read, and the entry is then updated with the same predicate and `RETURNING`. A write
 * that lost its race inserts nothing and updates nothing, so its `RETURNING` is empty, and one
 * read tells a `conflict` from a `not_found`.
 */

type Taken = Extract<WriteRefusal, { outcome: 'taken' }>

/**
 * Waits for a write batch. A batch that broke a unique key of `entries` has rolled back, and the
 * answer is `taken` by the entry that holds the key, found by `holder`. A unique violation nobody
 * holds the key for, and any other error, is not an outcome: it is thrown as it came.
 */
async function attempt<Results>(
  batch: Promise<Results>,
  holder: () => Promise<Taken | null>,
): Promise<{ readonly written: Results } | { readonly taken: Taken }> {
  try {
    return { written: await batch }
  } catch (error) {
    const taken = isUniqueViolation(error) ? await holder() : null
    if (taken === null) throw error
    return { taken }
  }
}

/** The entry that holds the slug or the translation that a new entry asks for; the slug first. */
async function holderOfNewEntry(
  db: Db,
  site: string,
  entry: EntryRef & { readonly translationGroup: string | null },
): Promise<Taken | null> {
  const rows = await db
    .select({ id: entries.id, slug: entries.slug })
    .from(entries)
    .where(
      and(
        eq(entries.siteId, site),
        eq(entries.collection, entry.collection),
        eq(entries.locale, entry.locale),
        or(
          eq(entries.slug, entry.slug),
          entry.translationGroup === null
            ? undefined
            : eq(entries.translationGroup, entry.translationGroup),
        ),
      ),
    )
  const bySlug = rows.find((row) => row.slug === entry.slug)
  if (bySlug !== undefined) return { outcome: 'taken', field: 'slug', by: bySlug.id }
  const [byGroup] = rows
  return byGroup === undefined
    ? null
    : { outcome: 'taken', field: 'translationGroup', by: byGroup.id }
}

/** The other entry of the collection and locale of `entryId` that is in `translationGroup`. */
async function holderOfTranslation(
  db: Db,
  site: string,
  entryId: string,
  translationGroup: string | null,
): Promise<Taken | null> {
  if (translationGroup === null) return null
  const other = alias(entries, 'other')
  const [row] = await db
    .select({ id: other.id })
    .from(entries)
    .innerJoin(
      other,
      and(
        eq(other.siteId, entries.siteId),
        eq(other.collection, entries.collection),
        eq(other.locale, entries.locale),
        eq(other.translationGroup, translationGroup),
        ne(other.id, entries.id),
      ),
    )
    .where(and(eq(entries.siteId, site), eq(entries.id, entryId)))
    .limit(1)
  return row === undefined ? null : { outcome: 'taken', field: 'translationGroup', by: row.id }
}

/** Why an update touched nothing: the entry moved on (`conflict`) or it is not there. */
async function whyNothingChanged(
  db: Db,
  site: string,
  entryId: string,
): Promise<Extract<WriteRefusal, { outcome: 'conflict' | 'not_found' }>> {
  const [row] = await db
    .select({ version: entries.version, headRev: entries.headRev })
    .from(entries)
    .where(and(eq(entries.siteId, site), eq(entries.id, entryId)))
    .limit(1)
  return row === undefined
    ? { outcome: 'not_found' }
    : { outcome: 'conflict', currentVersion: row.version, headRevision: row.headRev }
}

/** The revision as a read of it would give it back, for the answer of a write that made it. */
function storedRevision(input: {
  readonly id: string
  readonly entryId: string
  readonly now: string
  readonly revision: NewRevision
  readonly tags: readonly string[]
}): StoredRevision {
  const { revision } = input
  return {
    id: input.id,
    entryId: input.entryId,
    markdown: revision.markdown,
    frontmatter: revision.frontmatter,
    document: revision.document,
    comarkVersion: revision.comarkVersion,
    pipelineVersion: revision.pipelineVersion,
    wordCount: revision.wordCount,
    verdict: revision.verdict,
    tags: input.tags,
    actor: revision.actor,
    createdAt: input.now,
  }
}

export async function createEntry(
  db: Db,
  clock: Clock,
  site: string,
  entry: EntryRef & { readonly translationGroup: string | null; readonly revision: NewRevision },
): Promise<{ readonly outcome: 'saved'; readonly view: EntryView } | WriteRefusal> {
  const now = clock.now().toISOString()
  const entryId = newId('ent')
  const revisionId = newId('rev')
  const row = revisionRow({ id: revisionId, site, entryId, now, revision: entry.revision })
  const refusal = tooLarge(row)
  if (refusal !== null) return refusal
  const tags = distinctTags(entry.revision.tags)
  const result = await attempt(
    db.batch([
      db.insert(entries).values({
        id: entryId,
        siteId: site,
        collection: entry.collection,
        locale: entry.locale,
        slug: entry.slug,
        translationGroup: entry.translationGroup,
        status: 'draft',
        version: 1,
        headRev: revisionId,
        publishedRev: null,
        publishedAt: null,
        publishedSortKey: null,
        scheduledAt: null,
        createdAt: now,
        updatedAt: now,
      }),
      db.insert(revisions).values(row),
      ...insertTags(db, { site, revisionId, tags, now }),
    ]),
    () => holderOfNewEntry(db, site, entry),
  )
  if ('taken' in result) return result.taken
  return {
    outcome: 'saved',
    view: {
      entry: {
        id: entryId,
        collection: entry.collection,
        locale: entry.locale,
        slug: entry.slug,
        translationGroup: entry.translationGroup,
        status: 'draft',
        version: 1,
        headRevision: revisionId,
        publishedRevision: null,
        publishedAt: null,
        updatedAt: now,
      },
      revision: storedRevision({ id: revisionId, entryId, now, revision: entry.revision, tags }),
    },
  }
}

export async function appendRevision(
  db: Db,
  clock: Clock,
  site: string,
  write: {
    readonly entryId: string
    readonly expectedVersion: number
    readonly translationGroup: string | null
    readonly revision: NewRevision
  },
): Promise<{ readonly outcome: 'saved'; readonly view: EntryView } | WriteRefusal> {
  const now = clock.now().toISOString()
  const revisionId = newId('rev')
  const row = revisionRow({
    id: revisionId,
    site,
    entryId: write.entryId,
    now,
    revision: write.revision,
  })
  const refusal = tooLarge(row)
  if (refusal !== null) return refusal
  const tags = distinctTags(write.revision.tags)
  const result = await attempt(
    db.batch([
      insertRevisionAtVersion(db, row, write.expectedVersion),
      ...insertTags(db, { site, revisionId, tags, now }),
      db
        .update(entries)
        .set({
          version: sql`${entries.version} + 1`,
          headRev: revisionId,
          translationGroup: write.translationGroup,
          updatedAt: now,
        })
        .where(
          and(
            eq(entries.id, write.entryId),
            eq(entries.siteId, site),
            eq(entries.version, write.expectedVersion),
          ),
        )
        .returning(entryFields),
    ]),
    () => holderOfTranslation(db, site, write.entryId, write.translationGroup),
  )
  if ('taken' in result) return result.taken
  const updated = result.written.at(-1)
  const [changed] = Array.isArray(updated) ? updated : []
  if (changed === undefined) return whyNothingChanged(db, site, write.entryId)
  return {
    outcome: 'saved',
    view: {
      entry: toEntry(changed),
      revision: storedRevision({
        id: revisionId,
        entryId: write.entryId,
        now,
        revision: write.revision,
        tags,
      }),
    },
  }
}

export async function publish(
  db: Db,
  clock: Clock,
  site: string,
  write: {
    readonly entryId: string
    readonly expectedVersion: number
    readonly verdict: Verdict
    readonly acknowledged: readonly AcknowledgedWarning[]
    readonly actor: Actor
    readonly sortKey: string
  },
): Promise<{ readonly outcome: 'published'; readonly view: EntryView } | WriteRefusal> {
  const now = clock.now().toISOString()
  const row = publicationRow({
    site,
    entryId: write.entryId,
    now,
    actor: write.actor,
    // The statement names `head_rev` as it is when it runs, so its id is not known here; every
    // revision id has the same length, which is what the size of the row counts.
    publish: { revisionId: newId('rev'), verdict: write.verdict, acknowledged: write.acknowledged },
  })
  const refusal = tooLarge(row)
  if (refusal !== null) return refusal
  const results = await db.batch([
    insertPublishAtVersion(db, row, write.expectedVersion),
    db
      .update(entries)
      .set({
        status: 'published',
        publishedRev: entries.headRev,
        publishedAt: sql`coalesce(${entries.publishedAt}, ${now})`,
        publishedSortKey: write.sortKey,
        version: sql`${entries.version} + 1`,
        updatedAt: now,
      })
      .where(
        and(
          eq(entries.id, write.entryId),
          eq(entries.siteId, site),
          eq(entries.version, write.expectedVersion),
        ),
      )
      .returning(entryFields),
  ])
  const [changed] = results[1]
  if (changed === undefined) return whyNothingChanged(db, site, write.entryId)
  const entry = toEntry(changed)
  const revision =
    entry.publishedRevision === null ? null : await findRevision(db, site, entry.publishedRevision)
  if (revision === null) {
    throw new Error(`The revision that entry ${entry.id} was published at is not there`)
  }
  return { outcome: 'published', view: { entry, revision } }
}

export async function unpublish(
  db: Db,
  clock: Clock,
  site: string,
  write: { readonly entryId: string; readonly actor: Actor },
): Promise<{ readonly outcome: 'unpublished'; readonly view: EntryView } | WriteRefusal> {
  const now = clock.now().toISOString()
  const row = publicationRow({
    site,
    entryId: write.entryId,
    now,
    actor: write.actor,
    publish: null,
  })
  const refusal = tooLarge(row)
  if (refusal !== null) return refusal
  // Both statements only touch an entry that is published when they run: one that is not
  // stays as it is and gets no publication, and the answer below is its current view.
  await db.batch([
    insertUnpublishIfPublished(db, row),
    db
      .update(entries)
      .set({
        status: 'draft',
        publishedRev: null,
        publishedSortKey: null,
        version: sql`${entries.version} + 1`,
        updatedAt: now,
      })
      .where(
        and(
          eq(entries.id, write.entryId),
          eq(entries.siteId, site),
          eq(entries.status, 'published'),
        ),
      ),
  ])
  const view = await findEntryById(db, site, write.entryId, 'head')
  return view === null ? { outcome: 'not_found' } : { outcome: 'unpublished', view }
}
