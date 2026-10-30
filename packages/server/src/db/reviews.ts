import { newId } from '@hollware/core'
import { and, asc, desc, eq, getTableColumns, inArray, sql, type SQL } from 'drizzle-orm'
import type { BatchItem } from 'drizzle-orm/batch'
import type {
  Actor,
  AgentRunStatus,
  Clock,
  ReviewAction,
  ReviewStatus,
  StoredAgentRun,
  StoredReview,
  StoredReviewComment,
  StoredReviewItem,
  WriteRefusal,
} from '../ports.ts'
import { chunk } from './chunks.ts'
import type { Db } from './d1.ts'
import { GUARD_FAILED, isGuardFailure, isUniqueViolation } from './errors.ts'
import { parseAcknowledged } from './schedules.ts'
import {
  entries,
  outbox,
  reviewAgentRuns,
  reviewComments,
  reviewItems,
  reviews,
  revisions,
  sites,
  users,
} from './schema.ts'
import { valuesOf } from './statements.ts'

const STATUSES: readonly ReviewStatus[] = [
  'pending',
  'approved',
  'changes_requested',
  'rejected',
  'cancelled',
]

function statusOf(value: string): ReviewStatus {
  const status = STATUSES.find((known) => known === value)
  if (status === undefined) throw new Error(`A review has the status ${value}, which is no status`)
  return status
}

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

function entryAt(site: string, entryId: string, version: number, also: readonly SQL[] = []) {
  return sql`exists (select 1 from ${entries} where ${and(
    eq(entries.id, entryId),
    eq(entries.siteId, site),
    eq(entries.version, version),
    ...also,
  )})`
}

function holding(db: Db, site: string, entryId: string, also: readonly SQL[] = []) {
  return inArray(
    reviews.id,
    db
      .select({ id: reviewItems.reviewId })
      .from(reviewItems)
      .where(
        and(
          eq(reviewItems.siteId, site),
          eq(reviewItems.entryId, entryId),
          eq(reviewItems.active, 1),
          ...also,
        ),
      ),
  )
}

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
        eq(reviews.status, 'pending'),
        holding(db, site, entryId),
        entryAt(site, entryId, version, also),
      ),
    )
}

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
        eq(reviews.status, 'pending'),
        holding(db, site, entryId, [
          eq(reviewItems.action, 'publish'),
          sql`${reviewItems.revisionId} = (select ${entries.headRev} from ${entries} where ${and(eq(entries.id, entryId), eq(entries.siteId, site), eq(entries.version, version))})`,
        ]),
        sql`(select count(*) from ${reviewItems} where ${and(eq(reviewItems.siteId, site), eq(reviewItems.reviewId, reviews.id))}) = 1`,
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

function heldBy(
  db: Db,
  site: string,
  entryIds: readonly string[],
): Promise<readonly { readonly reviewId: string; readonly entryId: string }[]> {
  return db
    .select({ reviewId: reviewItems.reviewId, entryId: reviewItems.entryId })
    .from(reviewItems)
    .where(
      and(
        eq(reviewItems.siteId, site),
        inArray(reviewItems.entryId, [...entryIds]),
        eq(reviewItems.active, 1),
      ),
    )
}

export async function requestReview(
  db: Db,
  clock: Clock,
  site: string,
  write: {
    readonly items: readonly {
      readonly entryId: string
      readonly expectedVersion: number
      readonly action: ReviewAction
    }[]
    readonly acknowledged: readonly { readonly contract: string; readonly path: string }[]
    readonly actor: Actor
  },
  whyNothingChanged: (entryId: string) => Promise<WriteRefusal>,
): Promise<
  | { readonly outcome: 'pending_review'; readonly review: StoredReview }
  | { readonly outcome: 'held'; readonly review: StoredReview; readonly entryId: string }
  | (WriteRefusal & { readonly entryId: string })
> {
  const [first] = write.items
  if (first === undefined) throw new Error('A review is asked for no entry')
  const now = clock.now().toISOString()
  const id = newId('rvw')
  const atVersion = (item: (typeof write.items)[number]) =>
    and(
      eq(entries.id, item.entryId),
      eq(entries.siteId, site),
      eq(entries.version, item.expectedVersion),
      item.action === 'unpublish' ? eq(entries.status, 'published') : undefined,
    )
  const row = {
    id,
    siteId: site,
    entryId: first.entryId,
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
  const statements: BatchItem<'sqlite'>[] = write.items.map((item) =>
    db.insert(reviewItems).select(
      sql`select ${valuesOf(reviewItems, {
        id: newId('rvi'),
        siteId: site,
        reviewId: id,
        entryId: item.entryId,
        revisionId: item.action === 'publish' ? entries.headRev : null,
        baseRevisionId: entries.publishedRev,
        action: item.action,
        excluded: 0,
        active: 1,
        createdAt: now,
        updatedAt: now,
      })} from ${entries} where ${and(
        atVersion(item),
        sql`exists (select 1 from ${reviews} where ${and(eq(reviews.id, id), eq(reviews.siteId, site))})`,
      )}`,
    ),
  )
  const items = write.items.map((item) => ({ entryId: item.entryId, action: item.action }))
  try {
    await db.batch([
      db
        .insert(reviews)
        .select(sql`select ${valuesOf(reviews, row)} from ${entries} where ${atVersion(first)}`),
      ...statements,
      db
        .select({ failed: sql`json(${GUARD_FAILED})` })
        .from(sites)
        .where(
          and(
            eq(sites.id, site),
            sql`(select count(*) from ${reviewItems} where ${and(eq(reviewItems.siteId, site), eq(reviewItems.reviewId, id))}) < ${write.items.length}`,
          ),
        ),
      db
        .update(outbox)
        .set({
          payload: sql`json_set(${outbox.payload}, '$.items', json(${JSON.stringify(items)}))`,
        })
        .where(
          and(
            eq(outbox.siteId, site),
            eq(outbox.kind, 'review.requested'),
            eq(outbox.entryId, first.entryId),
            sql`${outbox.sentAt} is null`,
            sql`json_extract(${outbox.payload}, '$.review.id') = ${id}`,
          ),
        ),
    ])
  } catch (error) {
    if (isUniqueViolation(error)) {
      const [held] = await heldBy(
        db,
        site,
        write.items.map((item) => item.entryId),
      )
      const review =
        held === undefined
          ? await pendingOf(db, site, first.entryId)
          : await findReview(db, site, held.reviewId)
      if (review === null) throw error
      return { outcome: 'held', review, entryId: held?.entryId ?? first.entryId }
    }
    if (!isGuardFailure(error)) throw error
    for (const item of write.items) {
      const why = await whyNothingChanged(item.entryId)
      if (why.outcome !== 'conflict' || why.currentVersion !== item.expectedVersion) {
        return { ...why, entryId: item.entryId }
      }
    }
    const [moved] = write.items.filter((item) => item.action === 'unpublish')
    const why = await whyNothingChanged(moved?.entryId ?? first.entryId)
    return { ...why, entryId: moved?.entryId ?? first.entryId }
  }
  const review = await findReview(db, site, id)
  if (review === null) throw new Error(`The review ${id} that was just written is not there`)
  return { outcome: 'pending_review', review }
}

export async function reviewItemsOf(
  db: Db,
  site: string,
  reviewIds: readonly string[],
): Promise<ReadonlyMap<string, readonly StoredReviewItem[]>> {
  const byReview = new Map<string, StoredReviewItem[]>()
  for (const ids of chunk([...new Set(reviewIds)], 80)) {
    const rows = await db
      .select()
      .from(reviewItems)
      .where(and(eq(reviewItems.siteId, site), inArray(reviewItems.reviewId, ids)))
      .orderBy(asc(reviewItems.reviewId), sql`${reviewItems}.rowid`)
    for (const row of rows) {
      const list = byReview.get(row.reviewId) ?? []
      list.push({
        reviewId: row.reviewId,
        entryId: row.entryId,
        revisionId: row.revisionId,
        baseRevisionId: row.baseRevisionId,
        action: row.action === 'unpublish' ? 'unpublish' : 'publish',
        excluded: row.excluded === 1,
        active: row.active === 1,
      })
      byReview.set(row.reviewId, list)
    }
  }
  return byReview
}

export async function revisionMarkdown(
  db: Db,
  site: string,
  ids: readonly string[],
): Promise<ReadonlyMap<string, string>> {
  const found = new Map<string, string>()
  for (const some of chunk([...new Set(ids)], 80)) {
    const rows = await db
      .select({ id: revisions.id, markdown: revisions.markdown })
      .from(revisions)
      .where(and(eq(revisions.siteId, site), inArray(revisions.id, some)))
    for (const row of rows) found.set(row.id, row.markdown)
  }
  return found
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
  query: { readonly status: ReviewStatus; readonly limit: number; readonly entryId?: string },
): Promise<readonly StoredReview[]> {
  const rows = await db
    .select(COLUMNS)
    .from(reviews)
    .innerJoin(users, eq(users.id, reviews.requestedBy))
    .where(
      and(
        eq(reviews.siteId, site),
        eq(reviews.status, query.status),
        query.entryId === undefined ? undefined : eq(reviews.entryId, query.entryId),
      ),
    )
    .orderBy(desc(reviews.createdAt), desc(reviews.id))
    .limit(query.limit)
  return rows.map(toReview)
}

export function requestChanges(
  db: Db,
  clock: Clock,
  site: string,
  write: { readonly id: string; readonly note: string; readonly userId: string },
) {
  return closeReview(db, clock, site, write, 'changes_requested')
}

export function rejectReview(
  db: Db,
  clock: Clock,
  site: string,
  write: { readonly id: string; readonly note: string; readonly userId: string },
) {
  return closeReview(db, clock, site, write, 'rejected')
}

async function closeReview<Status extends 'changes_requested' | 'rejected'>(
  db: Db,
  clock: Clock,
  site: string,
  write: { readonly id: string; readonly note: string; readonly userId: string },
  status: Status,
): Promise<
  | { readonly outcome: Status | 'not_pending'; readonly review: StoredReview }
  | { readonly outcome: 'not_found' }
> {
  const now = clock.now().toISOString()
  const [row] = await db
    .update(reviews)
    .set({
      status,
      note: write.note,
      decidedBy: write.userId,
      decidedAt: now,
      updatedAt: now,
    })
    .where(and(eq(reviews.siteId, site), eq(reviews.id, write.id), eq(reviews.status, 'pending')))
    .returning({ id: reviews.id })
  const review = await findReview(db, site, write.id)
  if (row !== undefined && review !== null) return { outcome: status, review }
  return review === null ? { outcome: 'not_found' } : { outcome: 'not_pending', review }
}

function metaOf(text: string | null): Readonly<Record<string, unknown>> | null {
  if (text === null) return null
  const parsed: unknown = JSON.parse(text)
  return typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)
    ? Object.fromEntries(Object.entries(parsed))
    : null
}

const COMMENT_COLUMNS = {
  ...getTableColumns(reviewComments),
  authorName: users.name,
  authorKind: users.kind,
}

function toComment(
  row: typeof reviewComments.$inferSelect & {
    authorName: string | null
    authorKind: 'person' | 'agent'
  },
): StoredReviewComment {
  return {
    id: row.id,
    reviewId: row.reviewId,
    authorId: row.authorId,
    authorName: row.authorName,
    authorKind: row.authorKind === 'agent' ? 'agent' : 'person',
    authorMeta: metaOf(row.authorMeta),
    body: row.body,
    entryId: row.entryId,
    lines:
      row.lineFrom === null || row.lineTo === null ? null : { from: row.lineFrom, to: row.lineTo },
    createdAt: row.createdAt,
  }
}

export async function commentReview(
  db: Db,
  clock: Clock,
  site: string,
  write: {
    readonly reviewId: string
    readonly actor: Actor
    readonly body: string
    readonly entryId: string | null
    readonly lines: { readonly from: number; readonly to: number } | null
  },
): Promise<
  | { readonly outcome: 'commented'; readonly comment: StoredReviewComment }
  | { readonly outcome: 'not_pending' | 'not_found' }
> {
  const id = newId('rvc')
  const now = clock.now().toISOString()
  const meta = write.actor.meta === null ? null : JSON.stringify(write.actor.meta)
  const inserted = await db.all<{ id: string }>(sql`
    insert into ${reviewComments}
      (id, site_id, review_id, author_id, author_meta, body, created_at, updated_at, entry_id, line_from, line_to)
    select ${id}, ${site}, ${write.reviewId}, ${write.actor.userId}, ${meta}, ${write.body}, ${now}, ${now},
      ${write.entryId}, ${write.lines?.from ?? null}, ${write.lines?.to ?? null}
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

const RUN_STATUSES: readonly AgentRunStatus[] = ['queued', 'commented', 'failed']

export async function agentRunsOf(
  db: Db,
  site: string,
  reviewIds: readonly string[],
): Promise<ReadonlyMap<string, readonly StoredAgentRun[]>> {
  const byReview = new Map<string, StoredAgentRun[]>()
  if (reviewIds.length === 0) return byReview
  for (const ids of chunk([...reviewIds], 80)) {
    const rows = await db
      .select({
        reviewId: reviewAgentRuns.reviewId,
        agent: reviewAgentRuns.agent,
        status: reviewAgentRuns.status,
      })
      .from(reviewAgentRuns)
      .where(and(eq(reviewAgentRuns.siteId, site), inArray(reviewAgentRuns.reviewId, ids)))
      .orderBy(asc(reviewAgentRuns.agent))
    for (const row of rows) {
      const status = RUN_STATUSES.find((known) => known === row.status)
      if (status === undefined) continue
      const list = byReview.get(row.reviewId) ?? []
      list.push({ agent: row.agent, status })
      byReview.set(row.reviewId, list)
    }
  }
  return byReview
}

export async function markAgentRun(
  db: Db,
  clock: Clock,
  site: string,
  run: { readonly reviewId: string; readonly agent: string; readonly status: AgentRunStatus },
): Promise<void> {
  const now = clock.now().toISOString()
  const replaces =
    run.status === 'commented'
      ? sql`1`
      : run.status === 'failed'
        ? sql`${reviewAgentRuns.status} = 'queued'`
        : sql`${reviewAgentRuns.status} = 'failed'`
  await db
    .insert(reviewAgentRuns)
    .values({
      id: newId('rar'),
      siteId: site,
      reviewId: run.reviewId,
      agent: run.agent,
      status: run.status,
      createdAt: now,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: [reviewAgentRuns.reviewId, reviewAgentRuns.agent],
      set: { status: run.status, updatedAt: now },
      setWhere: and(eq(reviewAgentRuns.siteId, site), replaces),
    })
}
