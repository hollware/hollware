import { newId } from '@hollware/core'
import { and, desc, eq, sql } from 'drizzle-orm'
import type { Actor, Clock, ReviewStatus, StoredReview, WriteRefusal } from '../ports.ts'
import type { Db } from './d1.ts'
import { isUniqueViolation } from './errors.ts'
import { parseAcknowledged } from './schedules.ts'
import { entries, reviews } from './schema.ts'
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

function toReview(row: typeof reviews.$inferSelect): StoredReview {
  return {
    id: row.id,
    entryId: row.entryId,
    revisionId: row.revisionId,
    status: statusOf(row.status),
    acknowledged: parseAcknowledged(row.acknowledged),
    requestedBy: row.requestedBy,
    requestedAt: row.createdAt,
    decidedBy: row.decidedBy,
    decidedAt: row.decidedAt,
    note: row.note,
  }
}

/** The entry is still at `version`: the condition of every statement a write adds to its batch. */
function entryAt(site: string, entryId: string, version: number) {
  return sql`exists (select 1 from ${entries} where ${and(
    eq(entries.id, entryId),
    eq(entries.siteId, site),
    eq(entries.version, version),
  )})`
}

/** In the batch of a new revision: the pending review asked for another one, so it is cancelled. */
export function cancelPendingReview(
  db: Db,
  site: string,
  entryId: string,
  version: number,
  now: string,
) {
  return db
    .update(reviews)
    .set({ status: 'cancelled', updatedAt: now })
    .where(
      and(
        eq(reviews.siteId, site),
        eq(reviews.entryId, entryId),
        eq(reviews.status, 'pending'),
        entryAt(site, entryId, version),
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
    .select()
    .from(reviews)
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
    .select()
    .from(reviews)
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
    .select()
    .from(reviews)
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
    .returning()
  if (row !== undefined) return { outcome: 'changes_requested', review: toReview(row) }
  const review = await findReview(db, site, write.id)
  return review === null ? { outcome: 'not_found' } : { outcome: 'not_pending', review }
}
