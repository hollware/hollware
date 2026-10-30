import { newId } from '@hollware/core'
import type { EntryRef } from '@hollware/core'
import { and, desc, eq, inArray, isNotNull, isNull, lt, ne, or, sql, type SQL } from 'drizzle-orm'
import type { BatchItem } from 'drizzle-orm/batch'
import { alias } from 'drizzle-orm/sqlite-core'

import type {
  Actor,
  Clock,
  EntryView,
  InTrash,
  NewRevision,
  OutboxEvent,
  PublishWrite,
  StoredRedirect,
  StoredReview,
  StoredRevision,
  UnpublishWrite,
  WriteRefusal,
} from '../ports.ts'
import type { Db } from './d1.ts'
import { GUARD_FAILED, isGuardFailure, isUniqueViolation } from './errors.ts'
import { findEntryById, findRevision } from './reads.ts'
import { approvePendingReview, cancelPendingReview, findReview } from './reviews.ts'
import { dropSchedule, dropUnpublish } from './schedules.ts'
import { entryFields, toEntry } from './rows.ts'
import {
  entries,
  outbox,
  publications,
  redirects,
  reviewItems,
  reviews,
  revisions,
  schedules,
  sites,
} from './schema.ts'
import { tooLarge } from './size.ts'
import { valuesOf } from './statements.ts'
import {
  distinctTags,
  insertPublishAtVersion,
  insertRevisionAtVersion,
  insertTags,
  insertUnpublishIfPublished,
  publicationRow,
  revisionRow,
} from './statements.ts'

type Taken = Extract<WriteRefusal, { outcome: 'taken' }>

async function attempt<Results, Refusal extends Taken | InTrash = Taken>(
  batch: Promise<Results>,
  holder: () => Promise<Refusal | null>,
): Promise<{ readonly written: Results } | { readonly taken: Refusal }> {
  try {
    return { written: await batch }
  } catch (error) {
    const taken = isUniqueViolation(error) ? await holder() : null
    if (taken === null) throw error
    return { taken }
  }
}

async function holderOfNewEntry(
  db: Db,
  site: string,
  entry: EntryRef & { readonly translationGroup: string | null },
): Promise<Taken | InTrash | null> {
  const rows = await db
    .select({ id: entries.id, slug: entries.slug, deletedAt: entries.deletedAt })
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
  const holder = rows.find((row) => row.slug === entry.slug) ?? rows[0]
  if (holder === undefined) return null
  if (holder.deletedAt !== null) {
    const view = await findTrashed(db, site, holder.id)
    if (view !== null) return { outcome: 'in_trash', view }
  }
  return holder.slug === entry.slug
    ? { outcome: 'taken', field: 'slug', by: holder.id }
    : { outcome: 'taken', field: 'translationGroup', by: holder.id }
}

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

export async function whyNothingChanged(
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
    codeWords: revision.codeWords,
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
): Promise<{ readonly outcome: 'saved'; readonly view: EntryView } | WriteRefusal | InTrash> {
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
        scheduledAt: null,
        deletedAt: null,
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
      cancelPendingReview(db, site, write.entryId, write.expectedVersion, now),
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

function beforePublish(
  db: Db,
  site: string,
  write: PublishWrite,
  now: string,
  closesReviews: boolean,
): BatchItem<'sqlite'>[] {
  return [
    dropScheduleAtVersion(db, site, write.entryId, write.expectedVersion),
    insertEventWhere(db, site, write.entryId, write.event ?? null, 'entry.published', now, [
      eq(entries.version, write.expectedVersion),
    ]),
    ...(closesReviews
      ? [
          approvePendingReview(
            db,
            site,
            write.entryId,
            write.expectedVersion,
            write.actor.userId,
            now,
          ),
          cancelPendingReview(db, site, write.entryId, write.expectedVersion, now),
        ]
      : []),
  ]
}

function publishedAt(db: Db, site: string, write: PublishWrite, now: string) {
  return db
    .update(entries)
    .set({
      status: 'published',
      scheduledAt: null,
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
    .returning(entryFields)
}

function publicationOf(site: string, write: PublishWrite, now: string) {
  return publicationRow({
    site,
    entryId: write.entryId,
    now,
    actor: write.actor,
    publish: { revisionId: newId('rev'), verdict: write.verdict, acknowledged: write.acknowledged },
  })
}

export async function publish(
  db: Db,
  clock: Clock,
  site: string,
  write: PublishWrite,
): Promise<{ readonly outcome: 'published'; readonly view: EntryView } | WriteRefusal> {
  const now = clock.now().toISOString()
  const row = publicationOf(site, write, now)
  const refusal = tooLarge(row)
  if (refusal !== null) return refusal
  const results = await db.batch([
    insertPublishAtVersion(db, row, write.expectedVersion),
    ...beforePublish(db, site, write, now, true),
    publishedAt(db, site, write, now),
  ])
  const [changed] = results.at(-1) ?? []
  if (changed === undefined) return whyNothingChanged(db, site, write.entryId)
  const entry = toEntry(changed)
  const revision =
    entry.publishedRevision === null ? null : await findRevision(db, site, entry.publishedRevision)
  if (revision === null) {
    throw new Error(`The revision that entry ${entry.id} was published at is not there`)
  }
  return { outcome: 'published', view: { entry, revision } }
}

function unpublishStatements(db: Db, site: string, write: UnpublishWrite, now: string) {
  const atVersion = and(
    eq(entries.id, write.entryId),
    eq(entries.siteId, site),
    eq(entries.version, write.expectedVersion),
    eq(entries.status, 'published'),
  )
  const row = publicationRow({
    site,
    entryId: write.entryId,
    now,
    actor: write.actor,
    publish: null,
  })
  return {
    id: row.id,
    statements: [
      db
        .insert(publications)
        .select(sql`select ${valuesOf(publications, row)} from ${entries} where ${atVersion}`),
      insertEventWhere(db, site, write.entryId, write.event, 'entry.unpublished', now, [
        eq(entries.version, write.expectedVersion),
        eq(entries.status, 'published'),
      ]),
      dropSchedule(db, site, write.entryId),
      dropUnpublish(db, site, write.entryId),
      db
        .update(entries)
        .set({
          status: 'draft',
          scheduledAt: null,
          publishedRev: null,
          publishedSortKey: null,
          version: sql`${entries.version} + 1`,
          updatedAt: now,
        })
        .where(atVersion),
    ],
  }
}

function guardOf(db: Db, site: string, failed: SQL) {
  return db
    .select({ failed: sql`json(${GUARD_FAILED})` })
    .from(sites)
    .where(and(eq(sites.id, site), failed))
}

function publicationsMissing(site: string, ids: readonly string[]) {
  return sql`(select count(*) from ${publications} where ${and(eq(publications.siteId, site), inArray(publications.id, [...ids]))}) < ${ids.length}`
}

async function movedOf(
  db: Db,
  site: string,
  writes: readonly { readonly entryId: string; readonly expectedVersion: number }[],
): Promise<(WriteRefusal & { readonly entryId: string }) | null> {
  for (const write of writes) {
    const why = await whyNothingChanged(db, site, write.entryId)
    if (why.outcome === 'not_found' || why.currentVersion !== write.expectedVersion) {
      return { ...why, entryId: write.entryId }
    }
  }
  return null
}

export async function publishGroup(
  db: Db,
  clock: Clock,
  site: string,
  group: readonly PublishWrite[],
): Promise<
  | { readonly outcome: 'published'; readonly views: readonly EntryView[] }
  | (WriteRefusal & { readonly entryId: string })
> {
  const now = clock.now().toISOString()
  const statements: BatchItem<'sqlite'>[] = []
  const appended: string[] = []
  for (const write of group) {
    const row = publicationOf(site, write, now)
    const refusal = tooLarge(row)
    if (refusal !== null) return { ...refusal, entryId: write.entryId }
    appended.push(row.id)
    statements.push(
      insertPublishAtVersion(db, row, write.expectedVersion),
      ...beforePublish(db, site, write, now, true),
      publishedAt(db, site, write, now),
    )
  }
  try {
    const [first, ...rest]: BatchItem<'sqlite'>[] = [
      ...statements,
      guardOf(db, site, publicationsMissing(site, appended)),
    ]
    if (first !== undefined) await db.batch([first, ...rest])
  } catch (error) {
    if (!isGuardFailure(error)) throw error
    const moved = await movedOf(db, site, group)
    if (moved !== null) return moved
    throw new Error('A group publish failed, and every entry of the group is at its version', {
      cause: error,
    })
  }
  const views: EntryView[] = []
  for (const write of group) {
    const view = await findEntryById(db, site, write.entryId, 'published')
    if (view === null) throw new Error(`Entry ${write.entryId} is not published after its group`)
    views.push(view)
  }
  return { outcome: 'published', views }
}

export async function approveReview(
  db: Db,
  clock: Clock,
  site: string,
  write: {
    readonly reviewId: string
    readonly userId: string
    readonly publishes: readonly PublishWrite[]
    readonly unpublishes: readonly UnpublishWrite[]
    readonly excluded: readonly string[]
  },
): Promise<
  | { readonly outcome: 'approved' | 'not_pending'; readonly review: StoredReview }
  | { readonly outcome: 'not_found' }
  | (WriteRefusal & { readonly entryId: string })
> {
  const now = clock.now().toISOString()
  const pending = and(
    eq(reviews.id, write.reviewId),
    eq(reviews.siteId, site),
    eq(reviews.status, 'pending'),
  )
  const statements: BatchItem<'sqlite'>[] = [
    guardOf(db, site, sql`not exists (select 1 from ${reviews} where ${pending})`),
  ]
  const appended: string[] = []
  for (const publish of write.publishes) {
    const row = publicationOf(site, publish, now)
    const refusal = tooLarge(row)
    if (refusal !== null) return { ...refusal, entryId: publish.entryId }
    appended.push(row.id)
    statements.push(
      insertPublishAtVersion(db, row, publish.expectedVersion),
      ...beforePublish(db, site, publish, now, false),
      publishedAt(db, site, publish, now),
    )
  }
  for (const unpublish of write.unpublishes) {
    const written = unpublishStatements(db, site, unpublish, now)
    appended.push(written.id)
    statements.push(...written.statements)
  }
  const [first, ...rest]: BatchItem<'sqlite'>[] = [
    ...statements,
    db
      .update(reviewItems)
      .set({ excluded: 1, updatedAt: now })
      .where(
        and(
          eq(reviewItems.siteId, site),
          eq(reviewItems.reviewId, write.reviewId),
          inArray(reviewItems.entryId, [...write.excluded]),
        ),
      ),
    db
      .update(reviews)
      .set({ status: 'approved', decidedBy: write.userId, decidedAt: now, updatedAt: now })
      .where(pending),
    guardOf(db, site, publicationsMissing(site, appended)),
  ]
  try {
    if (first !== undefined) await db.batch([first, ...rest])
  } catch (error) {
    if (!isGuardFailure(error)) throw error
    const review = await findReview(db, site, write.reviewId)
    if (review === null) return { outcome: 'not_found' }
    if (review.status !== 'pending') return { outcome: 'not_pending', review }
    const moved = await movedOf(db, site, [...write.publishes, ...write.unpublishes])
    if (moved !== null) return moved
    const [unpublished] = write.unpublishes
    if (unpublished === undefined) throw error
    return {
      ...(await whyNothingChanged(db, site, unpublished.entryId)),
      entryId: unpublished.entryId,
    }
  }
  const review = await findReview(db, site, write.reviewId)
  if (review === null) throw new Error(`The review ${write.reviewId} is gone after its approval`)
  return { outcome: 'approved', review }
}

export async function unpublish(
  db: Db,
  clock: Clock,
  site: string,
  write: { readonly entryId: string; readonly actor: Actor; readonly event?: OutboxEvent | null },
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
  await db.batch([
    insertUnpublishIfPublished(db, row),
    insertEventWhere(db, site, write.entryId, write.event ?? null, 'entry.unpublished', now, [
      eq(entries.status, 'published'),
    ]),
    dropSchedule(db, site, write.entryId),
    dropUnpublish(db, site, write.entryId),
    db
      .update(entries)
      .set({
        status: 'draft',
        scheduledAt: null,
        publishedRev: null,
        publishedSortKey: null,
        version: sql`${entries.version} + 1`,
        updatedAt: now,
      })
      .where(
        and(
          eq(entries.id, write.entryId),
          eq(entries.siteId, site),
          inArray(entries.status, ['published', 'scheduled']),
        ),
      ),
  ])
  const view = await findEntryById(db, site, write.entryId, 'head')
  return view === null ? { outcome: 'not_found' } : { outcome: 'unpublished', view }
}

export async function trashEntry(
  db: Db,
  clock: Clock,
  site: string,
  write: { readonly entryId: string; readonly expectedVersion: number },
): Promise<
  | { readonly outcome: 'trashed' | 'not_draft'; readonly view: EntryView }
  | Extract<WriteRefusal, { readonly outcome: 'conflict' | 'not_found' }>
> {
  const now = clock.now().toISOString()
  const trashable = [eq(entries.status, 'draft'), isNull(entries.deletedAt)]
  const [, updated] = await db.batch([
    cancelPendingReview(db, site, write.entryId, write.expectedVersion, now, trashable),
    db
      .update(entries)
      .set({ deletedAt: now, version: sql`${entries.version} + 1`, updatedAt: now })
      .where(
        and(
          eq(entries.id, write.entryId),
          eq(entries.siteId, site),
          eq(entries.version, write.expectedVersion),
          ...trashable,
        ),
      )
      .returning({ id: entries.id }),
  ])
  if (updated.length === 0) {
    const view = await findEntryById(db, site, write.entryId, 'head')
    if (view === null) return { outcome: 'not_found' }
    if (view.entry.version !== write.expectedVersion) {
      return {
        outcome: 'conflict',
        currentVersion: view.entry.version,
        headRevision: view.entry.headRevision,
      }
    }
    return { outcome: 'not_draft', view }
  }
  const view = await findTrashed(db, site, write.entryId)
  if (view === null)
    throw new Error(`Entry ${write.entryId} is not in the trash after its trashing`)
  return { outcome: 'trashed', view }
}

export async function restoreEntry(
  db: Db,
  clock: Clock,
  site: string,
  entryId: string,
): Promise<
  | { readonly outcome: 'restored' | 'not_trashed'; readonly view: EntryView }
  | { readonly outcome: 'not_found' }
> {
  const now = clock.now().toISOString()
  const updated = await db
    .update(entries)
    .set({ deletedAt: null, version: sql`${entries.version} + 1`, updatedAt: now })
    .where(and(eq(entries.id, entryId), eq(entries.siteId, site), isNotNull(entries.deletedAt)))
    .returning({ id: entries.id })
  const view = await findEntryById(db, site, entryId, 'head')
  if (view === null) return { outcome: 'not_found' }
  return { outcome: updated.length === 0 ? 'not_trashed' : 'restored', view }
}

async function findTrashed(db: Db, site: string, entryId: string): Promise<EntryView | null> {
  const [row] = await db
    .select({ entry: entryFields, headRev: entries.headRev })
    .from(entries)
    .where(and(eq(entries.id, entryId), eq(entries.siteId, site), isNotNull(entries.deletedAt)))
    .limit(1)
  if (row === undefined) return null
  const revision = await findRevision(db, site, row.headRev)
  if (revision === null) throw new Error(`The head revision of entry ${entryId} is not there`)
  return { entry: toEntry(row.entry), revision }
}

function dropScheduleAtVersion(db: Db, site: string, entryId: string, version: number) {
  return db
    .delete(schedules)
    .where(
      and(
        eq(schedules.siteId, site),
        eq(schedules.entryId, entryId),
        sql`exists (select 1 from ${entries} where ${and(eq(entries.id, entryId), eq(entries.siteId, site), eq(entries.version, version))})`,
      ),
    )
}

function insertEventWhere(
  db: Db,
  site: string,
  entryId: string,
  event: OutboxEvent | null,
  kind: 'entry.published' | 'entry.unpublished',
  now: string,
  conditions: SQL[],
) {
  const row = {
    id: event?.id ?? 'evt_none',
    siteId: site,
    kind,
    entryId,
    payload: event?.payload ?? '{}',
    sentAt: null,
    abandonedAt: null,
    createdAt: now,
    updatedAt: now,
  }
  return db
    .insert(outbox)
    .select(
      sql`select ${valuesOf(outbox, row)} from ${entries} where ${and(eq(entries.id, entryId), eq(entries.siteId, site), sql`${event === null ? 0 : 1} = 1`, ...conditions)}`,
    )
}

export async function moveEntry(
  db: Db,
  clock: Clock,
  site: string,
  write: {
    readonly entryId: string
    readonly expectedVersion: number
    readonly slug: string
    readonly redirect: boolean
    readonly event: OutboxEvent | null
  },
): Promise<{ readonly outcome: 'moved'; readonly view: EntryView } | WriteRefusal> {
  const now = clock.now().toISOString()
  const atVersion = and(
    eq(entries.id, write.entryId),
    eq(entries.siteId, site),
    eq(entries.version, write.expectedVersion),
    isNull(entries.deletedAt),
  )
  const before = await findEntryById(db, site, write.entryId, 'head')
  if (before === null) return { outcome: 'not_found' }
  if (before.entry.version !== write.expectedVersion) {
    return {
      outcome: 'conflict',
      currentVersion: before.entry.version,
      headRevision: before.entry.headRevision,
    }
  }
  const [holder] = await db
    .select({ id: entries.id })
    .from(entries)
    .where(
      and(
        eq(entries.siteId, site),
        eq(entries.collection, before.entry.collection),
        eq(entries.locale, before.entry.locale),
        eq(entries.slug, write.slug),
      ),
    )
  if (holder !== undefined) return { outcome: 'taken', field: 'slug', by: holder.id }
  const row = {
    id: newId('rdr'),
    siteId: site,
    collection: before.entry.collection,
    locale: before.entry.locale,
    fromSlug: before.entry.slug,
    entryId: write.entryId,
    createdAt: now,
    updatedAt: now,
  }
  const statements: BatchItem<'sqlite'>[] = [
    db
      .delete(redirects)
      .where(
        and(
          eq(redirects.siteId, site),
          eq(redirects.collection, before.entry.collection),
          eq(redirects.locale, before.entry.locale),
          eq(redirects.fromSlug, write.slug),
          sql`exists (select 1 from ${entries} where ${atVersion})`,
        ),
      ),
    ...(write.redirect
      ? [
          db
            .insert(redirects)
            .select(sql`select ${valuesOf(redirects, row)} from ${entries} where ${atVersion}`)
            .onConflictDoUpdate({
              target: [
                redirects.siteId,
                redirects.collection,
                redirects.locale,
                redirects.fromSlug,
              ],
              set: { entryId: write.entryId, updatedAt: now },
            }),
        ]
      : []),
    insertEventWhere(db, site, write.entryId, write.event, 'entry.published', now, [
      eq(entries.version, write.expectedVersion),
      eq(entries.status, 'published'),
    ]),
    db
      .update(entries)
      .set({ slug: write.slug, version: sql`${entries.version} + 1`, updatedAt: now })
      .where(atVersion),
  ]
  const [first, ...rest] = statements
  if (first !== undefined) await db.batch([first, ...rest])
  const view = await findEntryById(db, site, write.entryId, 'head')
  if (view === null) return { outcome: 'not_found' }
  if (view.entry.version !== write.expectedVersion + 1 || view.entry.slug !== write.slug) {
    return {
      outcome: 'conflict',
      currentVersion: view.entry.version,
      headRevision: view.entry.headRevision,
    }
  }
  return { outcome: 'moved', view }
}

export async function listRedirects(
  db: Db,
  site: string,
  query: {
    readonly collection?: string
    readonly locale?: string
    readonly limit: number
    readonly cursor: { readonly createdAt: string; readonly id: string } | null
  },
): Promise<readonly StoredRedirect[]> {
  const rows = await db
    .select({
      id: redirects.id,
      collection: redirects.collection,
      locale: redirects.locale,
      from: redirects.fromSlug,
      entryId: redirects.entryId,
      to: entries.slug,
      createdAt: redirects.createdAt,
    })
    .from(redirects)
    .innerJoin(
      entries,
      and(eq(entries.id, redirects.entryId), eq(entries.siteId, redirects.siteId)),
    )
    .where(
      and(
        eq(redirects.siteId, site),
        isNull(entries.deletedAt),
        query.collection === undefined ? undefined : eq(redirects.collection, query.collection),
        query.locale === undefined ? undefined : eq(redirects.locale, query.locale),
        query.cursor === null
          ? undefined
          : or(
              lt(redirects.createdAt, query.cursor.createdAt),
              and(
                eq(redirects.createdAt, query.cursor.createdAt),
                lt(redirects.id, query.cursor.id),
              ),
            ),
      ),
    )
    .orderBy(desc(redirects.createdAt), desc(redirects.id))
    .limit(query.limit)
  return rows
}
