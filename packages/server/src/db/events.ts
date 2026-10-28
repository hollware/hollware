import { newId } from '@hollware/core'
import { and, desc, eq, inArray, isNull, lte, sql } from 'drizzle-orm'
import type { Db } from './d1.ts'
import { deliveries, outbox } from './schema.ts'

export interface StoredEvent {
  readonly id: string
  readonly kind: string
  readonly payload: string
}

export async function findEvent(db: Db, site: string, id: string): Promise<StoredEvent | null> {
  const [row] = await db
    .select({ id: outbox.id, kind: outbox.kind, payload: outbox.payload })
    .from(outbox)
    .where(and(eq(outbox.siteId, site), eq(outbox.id, id)))
    .limit(1)
  return row ?? null
}

export async function unsentEvents(db: Db, site: string, before: string, limit = 100) {
  const rows = await db
    .select({ id: outbox.id })
    .from(outbox)
    .where(and(eq(outbox.siteId, site), isNull(outbox.sentAt), lte(outbox.createdAt, before)))
    .orderBy(outbox.createdAt)
    .limit(limit)
  return rows.map((row) => row.id)
}

export async function markSent(db: Db, site: string, ids: readonly string[], now: string) {
  if (ids.length === 0) return
  await db
    .update(outbox)
    .set({ sentAt: now, updatedAt: now })
    .where(and(eq(outbox.siteId, site), inArray(outbox.id, [...ids])))
}

export async function abandonEvent(db: Db, site: string, id: string, now: string) {
  const rows = await db
    .update(outbox)
    .set({ abandonedAt: now, updatedAt: now })
    .where(and(eq(outbox.siteId, site), eq(outbox.id, id), isNull(outbox.abandonedAt)))
    .returning({ id: outbox.id })
  return rows.length > 0
}

const undelivered = sql`exists (select 1 from ${deliveries} where ${deliveries.eventId} = ${outbox.id} and ${deliveries.siteId} = ${outbox.siteId} and ${deliveries.deliveredAt} is null)`

export async function sendAgain(db: Db, site: string, id: string, now: string): Promise<boolean> {
  const rows = await db
    .update(outbox)
    .set({ abandonedAt: null, sentAt: null, updatedAt: now })
    .where(and(eq(outbox.siteId, site), eq(outbox.id, id), undelivered))
    .returning({ id: outbox.id })
  return rows.length > 0
}

export interface FailedDelivery {
  readonly event: string
  readonly kind: string
  readonly payload: string
  readonly subscriber: string
  readonly attempts: number
  readonly lastError: string | null
  readonly triedAt: string
  readonly abandonedAt: string | null
}

export async function failedDeliveries(
  db: Db,
  site: string,
  limit: number,
): Promise<FailedDelivery[]> {
  return db
    .select({
      event: deliveries.eventId,
      kind: outbox.kind,
      payload: outbox.payload,
      subscriber: deliveries.subscriber,
      attempts: deliveries.attempts,
      lastError: deliveries.lastError,
      triedAt: deliveries.updatedAt,
      abandonedAt: outbox.abandonedAt,
    })
    .from(deliveries)
    .innerJoin(outbox, and(eq(outbox.id, deliveries.eventId), eq(outbox.siteId, deliveries.siteId)))
    .where(and(eq(deliveries.siteId, site), isNull(deliveries.deliveredAt)))
    .orderBy(desc(deliveries.updatedAt), desc(deliveries.id))
    .limit(limit)
}

export async function deliveredTo(db: Db, site: string, eventId: string): Promise<Set<string>> {
  const rows = await db
    .select({ subscriber: deliveries.subscriber, deliveredAt: deliveries.deliveredAt })
    .from(deliveries)
    .where(and(eq(deliveries.siteId, site), eq(deliveries.eventId, eventId)))
  return new Set(rows.filter((row) => row.deliveredAt !== null).map((row) => row.subscriber))
}

export async function recordAttempt(
  db: Db,
  input: {
    readonly site: string
    readonly eventId: string
    readonly subscriber: string
    readonly now: string
    readonly error: string | null
  },
) {
  const deliveredAt = input.error === null ? input.now : null
  await db
    .insert(deliveries)
    .values({
      id: newId('dlv'),
      siteId: input.site,
      eventId: input.eventId,
      subscriber: input.subscriber,
      attempts: 1,
      deliveredAt,
      lastError: input.error,
      createdAt: input.now,
      updatedAt: input.now,
    })
    .onConflictDoUpdate({
      target: [deliveries.eventId, deliveries.subscriber],
      set: {
        attempts: sqlIncrement(),
        deliveredAt,
        lastError: input.error,
        updatedAt: input.now,
      },
    })
}

function sqlIncrement() {
  return sql`${deliveries.attempts} + 1`
}
