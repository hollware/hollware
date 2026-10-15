import { newId } from '@hollware/core'
import type { AcknowledgedWarning } from '@hollware/core'
import { and, eq, lte, sql } from 'drizzle-orm'
import type { Actor, Clock, EntryView, StoredSchedule, WriteRefusal } from '../ports.ts'
import type { Db } from './d1.ts'
import { findEntryById } from './reads.ts'
import { entries, schedules } from './schema.ts'
import { actorColumns, valuesOf } from './statements.ts'

/**
 * Scheduled publications (ADR-025). An entry waits in status `scheduled` with its `scheduled_at`,
 * and its row of `schedules` says what was acknowledged and by whom, for the cron trigger that
 * publishes it once the time has passed.
 */

/** Statements that drop the schedule of an entry, in the batch of a write that ends it. */
export function dropSchedule(db: Db, site: string, entryId: string) {
  return db.delete(schedules).where(and(eq(schedules.siteId, site), eq(schedules.entryId, entryId)))
}

export async function schedule(
  db: Db,
  clock: Clock,
  site: string,
  write: {
    readonly entryId: string
    readonly expectedVersion: number
    readonly scheduledAt: string
    readonly acknowledged: readonly AcknowledgedWarning[]
    readonly actor: Actor
  },
): Promise<{ readonly outcome: 'scheduled'; readonly view: EntryView } | WriteRefusal> {
  const now = clock.now().toISOString()
  const row = {
    id: newId('sch'),
    siteId: site,
    entryId: write.entryId,
    scheduledAt: write.scheduledAt,
    version: write.expectedVersion + 1,
    acknowledged: JSON.stringify(write.acknowledged),
    ...actorColumns(write.actor),
    createdAt: now,
    updatedAt: now,
  }
  const atVersion = and(
    eq(entries.id, write.entryId),
    eq(entries.siteId, site),
    eq(entries.version, write.expectedVersion),
    sql`${entries.status} <> 'published'`,
  )
  const results = await db.batch([
    db
      .delete(schedules)
      .where(
        and(
          eq(schedules.siteId, site),
          eq(schedules.entryId, write.entryId),
          sql`exists (select 1 from ${entries} where ${atVersion})`,
        ),
      ),
    db
      .insert(schedules)
      .select(sql`select ${valuesOf(schedules, row)} from ${entries} where ${atVersion}`),
    db
      .update(entries)
      .set({
        status: 'scheduled',
        scheduledAt: write.scheduledAt,
        version: sql`${entries.version} + 1`,
        updatedAt: now,
      })
      .where(atVersion)
      .returning({ id: entries.id }),
  ])
  const view = await findEntryById(db, site, write.entryId, 'head')
  if (view === null) return { outcome: 'not_found' }
  if (results[2].length === 0) {
    return {
      outcome: 'conflict',
      currentVersion: view.entry.version,
      headRevision: view.entry.headRevision,
    }
  }
  return { outcome: 'scheduled', view }
}

/** The schedules of a site whose time has come, oldest first. */
export async function dueSchedules(
  db: Db,
  site: string,
  now: string,
): Promise<readonly StoredSchedule[]> {
  const rows = await db
    .select()
    .from(schedules)
    .where(and(eq(schedules.siteId, site), lte(schedules.scheduledAt, now)))
    .orderBy(schedules.scheduledAt)
    .limit(50)
  return rows.map((row) => ({
    entryId: row.entryId,
    scheduledAt: row.scheduledAt,
    version: row.version,
    acknowledged: parseAcknowledged(row.acknowledged),
    actor: {
      kind: actorKindOf(row.actorKind),
      userId: row.actorUserId,
      tokenId: row.actorTokenId,
      meta: row.actorMeta === null ? null : parseMeta(row.actorMeta),
    },
  }))
}

/** Takes an entry out of `scheduled`, back to a draft, and drops its schedule. */
export async function cancelSchedule(
  db: Db,
  clock: Clock,
  site: string,
  entryId: string,
): Promise<void> {
  await db.batch([
    dropSchedule(db, site, entryId),
    db
      .update(entries)
      .set({
        status: 'draft',
        scheduledAt: null,
        version: sql`${entries.version} + 1`,
        updatedAt: clock.now().toISOString(),
      })
      .where(
        and(eq(entries.id, entryId), eq(entries.siteId, site), eq(entries.status, 'scheduled')),
      ),
  ])
}

export function parseAcknowledged(text: string): AcknowledgedWarning[] {
  const value: unknown = JSON.parse(text)
  if (!Array.isArray(value)) return []
  return value.flatMap((item: unknown) =>
    typeof item === 'object' &&
    item !== null &&
    'contract' in item &&
    'path' in item &&
    typeof item.contract === 'string' &&
    typeof item.path === 'string'
      ? [{ contract: item.contract, path: item.path }]
      : [],
  )
}

/** The kind of an actor as the `*_actor_kind` checks allow it. */
function actorKindOf(value: string): Actor['kind'] {
  if (value === 'token' || value === 'user' || value === 'oauth_client') return value
  throw new Error(`A schedule has the actor kind ${value}, which is no kind`)
}

function parseMeta(text: string): Record<string, unknown> | null {
  const value: unknown = JSON.parse(text)
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? Object.fromEntries(Object.entries(value))
    : null
}
