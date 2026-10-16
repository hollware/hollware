import { newId } from '@hollware/core'
import { and, asc, desc, eq, getTableColumns, inArray, sql, type SQL } from 'drizzle-orm'
import type {
  Actor,
  Clock,
  ReviewStatus,
  StoredReview,
  StoredReviewComment,
  WriteRefusal,
} from '../ports.ts'
import type { Db } from './d1.ts'
import { isUniqueViolation } from './errors.ts'
import { parseAcknowledged } from './schedules.ts'
import { entries, reviewComments, reviews, users } from './schema.ts'
import { valuesOf } from './statements.ts'

/**
 * Reviews (v0.3). A person who may write but not publish asks for the head revision of an entry
 * to be published; a person who may publish approves it, which publishes it, or asks for changes.
 * The partial unique index `reviews_pending` keeps one pending review per entry. A write that
 * moves the entry closes the pending review in its own batch: a new revision cancels it
 * (`cancelPendingReview`), a publication approves it (`approvePendingReview`).
 */

const STATUSES: readonly ReviewStatus[] = ['pending', 'approved', 'changes_requested', 'cancelled']

function statusOf(value: string): ReviewStatus {
  const status = STATUSES.find((known) => known === value)
  if (status === undefined) throw new Error(`A review has the status ${value}, which is no status`)
  return status
}

/** The columns of a review, and the name of who asked for it. */
const COLUMNS = { ...getTableColumns(reviews), requestedByName: users.name }

function toReview(
  row: typeof reviews.$inferSelect & { requestedByName: string | null },
): StoredReview {
  return {
    id: row.id,
    entryId: row.entryId,
    revisionId: row.revisionId,
    status: statusOf(row.status),
    acknowledged: parseAcknowledged(row.acknowledged),
    requestedBy: row.requestedBy,
    requestedByName: row.requestedByName,
    requestedAt: row.createdAt,
    decidedBy: row.decidedBy,
    decidedAt: row.decidedAt,
    note: row.note,
  }
}

/**
 * The entry is still at `version`, and in the state `also` says: the condition of every statement
 * a write adds to its batch.
 */
function entryAt(site: string, entryId: string, version: number, also: readonly SQL[] = []) {
  return sql`exists (select 1 from ${entries} where ${and(
    eq(entries.id, entryId),
    eq(entries.siteId, site),
    eq(entries.version, version),
    ...also,
  )})`
}

/**
 * In the batch of a new revision: the pending review asked for another one, so it is cancelled.
 * In the batch of a trashing, too, where `also` holds what makes the entry one the trash takes.
 */
export function cancelPendingReview(
  db: Db,
  site: string,
  entryId: string,
  version: number,
  now: string,
  also: readonly SQL[] = [],
) {
  return db
    .update(reviews)
    .set({ status: 'cancelled', updatedAt: now })
    .where(
      and(
        eq(reviews.siteId, site),
        eq(reviews.entryId, entryId),
        eq(reviews.status, 'pending'),
        entryAt(site, entryId, version, also),
      ),
    )
}

/** In the batch of a publication: what the pending review asked for is published, by `userId`. */
export function approvePendingReview(
  db: Db,
  site: string,
  entryId: string,
  version: number,
  userId: string,
  now: string,
) {
  return db
    .update(reviews)
    .set({ status: 'approved', decidedBy: userId, decidedAt: now, updatedAt: now })
    .where(
      and(
        eq(reviews.siteId, site),
        eq(reviews.entryId, entryId),
        eq(reviews.status, 'pending'),
        // The pending review is of the head: a new revision would have cancelled it.
        sql`${reviews.revisionId} = (select ${entries.headRev} from ${entries} where ${and(eq(entries.id, entryId), eq(entries.siteId, site), eq(entries.version, version))})`,
      ),
    )
}

async function pendingOf(db: Db, site: string, entryId: string): Promise<StoredReview | null> {
  const [row] = await db
    .select(COLUMNS)
    .from(reviews)
    .innerJoin(users, eq(users.id, reviews.requestedBy))
    .where(
      and(eq(reviews.siteId, site), eq(reviews.entryId, entryId), eq(reviews.status, 'pending')),
    )
    .limit(1)
  return row === undefined ? null : toReview(row)
}

export async function requestReview(
  db: Db,
  clock: Clock,
  site: string,
  write: {
    readonly entryId: string
    readonly expectedVersion: number
    readonly acknowledged: readonly { readonly contract: string; readonly path: string }[]
    readonly actor: Actor
  },
  whyNothingChanged: () => Promise<WriteRefusal>,
): Promise<{ readonly outcome: 'pending_review'; readonly review: StoredReview } | WriteRefusal> {
  const now = clock.now().toISOString()
  const row = {
    id: newId('rvw'),
    siteId: site,
    entryId: write.entryId,
    // The head of the entry as the statement runs, where the entry is at the version read.
    revisionId: entries.headRev,
    status: 'pending',
    acknowledged: JSON.stringify(write.acknowledged),
    requestedBy: write.actor.userId,
    requestedMeta: write.actor.meta === null ? null : JSON.stringify(write.actor.meta),
    decidedBy: null,
    decidedAt: null,
    note: null,
    createdAt: now,
    updatedAt: now,
  }
  let inserted: readonly { readonly id: string }[]
  try {
    inserted = await db
      .insert(reviews)
      .select(
        sql`select ${valuesOf(reviews, row)} from ${entries} where ${and(
          eq(entries.id, write.entryId),
          eq(entries.siteId, site),
          eq(entries.version, write.expectedVersion),
        )}`,
      )
      .returning({ id: reviews.id })
  } catch (error) {
    // The entry has a pending review already, of its head: asking again answers it.
    const pending = isUniqueViolation(error) ? await pendingOf(db, site, write.entryId) : null
    if (pending === null) throw error
    return { outcome: 'pending_review', review: pending }
  }
  if (inserted.length === 0) return whyNothingChanged()
  const review = await findReview(db, site, row.id)
  if (review === null) throw new Error(`The review ${row.id} that was just written is not there`)
  return { outcome: 'pending_review', review }
}

export async function findReview(db: Db, site: string, id: string): Promise<StoredReview | null> {
  const [row] = await db
    .select(COLUMNS)
    .from(reviews)
    .innerJoin(users, eq(users.id, reviews.requestedBy))
    .where(and(eq(reviews.siteId, site), eq(reviews.id, id)))
    .limit(1)
  return row === undefined ? null : toReview(row)
}

export async function listReviews(
  db: Db,
  site: string,
  query: { readonly status: ReviewStatus; readonly limit: number },
): Promise<readonly StoredReview[]> {
  const rows = await db
    .select(COLUMNS)
    .from(reviews)
    .innerJoin(users, eq(users.id, reviews.requestedBy))
    .where(and(eq(reviews.siteId, site), eq(reviews.status, query.status)))
    .orderBy(desc(reviews.createdAt), desc(reviews.id))
    .limit(query.limit)
  return rows.map(toReview)
}

export async function requestChanges(
  db: Db,
  clock: Clock,
  site: string,
  write: { readonly id: string; readonly note: string; readonly userId: string },
): Promise<
  | { readonly outcome: 'changes_requested' | 'not_pending'; readonly review: StoredReview }
  | { readonly outcome: 'not_found' }
> {
  const now = clock.now().toISOString()
  const [row] = await db
    .update(reviews)
    .set({
      status: 'changes_requested',
      note: write.note,
      decidedBy: write.userId,
      decidedAt: now,
      updatedAt: now,
    })
    .where(and(eq(reviews.siteId, site), eq(reviews.id, write.id), eq(reviews.status, 'pending')))
    .returning({ id: reviews.id })
  const review = await findReview(db, site, write.id)
  if (row !== undefined && review !== null) return { outcome: 'changes_requested', review }
  return review === null ? { outcome: 'not_found' } : { outcome: 'not_pending', review }
}

function metaOf(text: string | null): Readonly<Record<string, unknown>> | null {
  if (text === null) return null
  const parsed: unknown = JSON.parse(text)
  return typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)
    ? Object.fromEntries(Object.entries(parsed))
    : null
}

const COMMENT_COLUMNS = { ...getTableColumns(reviewComments), authorName: users.name }

function toComment(
  row: typeof reviewComments.$inferSelect & { authorName: string | null },
): StoredReviewComment {
  return {
    id: row.id,
    reviewId: row.reviewId,
    authorId: row.authorId,
    authorName: row.authorName,
    authorMeta: metaOf(row.authorMeta),
    body: row.body,
    createdAt: row.createdAt,
  }
}

/**
 * Adds a comment to a review in one statement that inserts only while the review is pending, so a
 * decision that lands first leaves no comment behind it.
 */
export async function commentReview(
  db: Db,
  clock: Clock,
  site: string,
  write: { readonly reviewId: string; readonly actor: Actor; readonly body: string },
): Promise<
  | { readonly outcome: 'commented'; readonly comment: StoredReviewComment }
  | { readonly outcome: 'not_pending' | 'not_found' }
> {
  const id = newId('rvc')
  const now = clock.now().toISOString()
  const meta = write.actor.meta === null ? null : JSON.stringify(write.actor.meta)
  const inserted = await db.all<{ id: string }>(sql`
    insert into ${reviewComments}
      (id, site_id, review_id, author_id, author_meta, body, created_at, updated_at)
    select ${id}, ${site}, ${write.reviewId}, ${write.actor.userId}, ${meta}, ${write.body}, ${now}, ${now}
    where exists (select 1 from ${reviews} where ${and(
      eq(reviews.id, write.reviewId),
      eq(reviews.siteId, site),
      eq(reviews.status, 'pending'),
    )})
    returning id
  `)
  if (inserted.length === 0) {
    const review = await findReview(db, site, write.reviewId)
    return { outcome: review === null ? 'not_found' : 'not_pending' }
  }
  const [row] = await db
    .select(COMMENT_COLUMNS)
    .from(reviewComments)
    .innerJoin(users, eq(users.id, reviewComments.authorId))
    .where(and(eq(reviewComments.siteId, site), eq(reviewComments.id, id)))
    .limit(1)
  if (row === undefined) throw new Error(`The comment ${id} that was just written is not there`)
  return { outcome: 'commented', comment: toComment(row) }
}

export async function reviewCommentsOf(
  db: Db,
  site: string,
  reviewIds: readonly string[],
): Promise<ReadonlyMap<string, readonly StoredReviewComment[]>> {
  const byReview = new Map<string, StoredReviewComment[]>()
  if (reviewIds.length === 0) return byReview
  const rows = await db
    .select(COMMENT_COLUMNS)
    .from(reviewComments)
    .innerJoin(users, eq(users.id, reviewComments.authorId))
    .where(and(eq(reviewComments.siteId, site), inArray(reviewComments.reviewId, [...reviewIds])))
    .orderBy(asc(reviewComments.createdAt), asc(reviewComments.id))
  for (const row of rows) {
    const list = byReview.get(row.reviewId) ?? []
    list.push(toComment(row))
    byReview.set(row.reviewId, list)
  }
  return byReview
}
