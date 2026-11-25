import { newId } from '@hollware/core'
import type { AcknowledgedWarning } from '@hollware/core'
import { and, eq, inArray, isNull, lte, sql } from 'drizzle-orm'
import type { BatchItem } from 'drizzle-orm/batch'
import type {
  Actor,
  Clock,
  EntryView,
  StoredSchedule,
  StoredUnpublish,
  WriteRefusal,
} from '../ports.ts'
import type { Db } from './d1.ts'
import { GUARD_FAILED, isGuardFailure } from './errors.ts'
import { findEntryById } from './reads.ts'
import { entries, schedules, sites, unpublishes } from './schema.ts'
import { actorColumns, valuesOf } from './statements.ts'

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
    groupId: null,
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

export async function scheduleGroup(
  db: Db,
  clock: Clock,
  site: string,
  write: {
    readonly members: readonly { readonly entryId: string; readonly expectedVersion: number }[]
    readonly scheduledAt: string
    readonly acknowledged: readonly AcknowledgedWarning[]
    readonly actor: Actor
  },
): Promise<
  | { readonly outcome: 'scheduled'; readonly views: readonly EntryView[] }
  | (WriteRefusal & { readonly entryId: string })
> {
  const now = clock.now().toISOString()
  const rows = write.members.map((member) => ({
    id: newId('sch'),
    siteId: site,
    entryId: member.entryId,
    scheduledAt: write.scheduledAt,
    version: member.expectedVersion + 1,
    acknowledged: JSON.stringify(write.acknowledged),
    ...actorColumns(write.actor),
    createdAt: now,
    updatedAt: now,
  }))
  const groupId = rows[0]?.id ?? null
  const statements: BatchItem<'sqlite'>[] = []
  write.members.forEach((member, at) => {
    const row = rows[at]
    if (row === undefined) return
    const atVersion = and(
      eq(entries.id, member.entryId),
      eq(entries.siteId, site),
      eq(entries.version, member.expectedVersion),
      sql`${entries.status} <> 'published'`,
    )
    statements.push(
      db
        .delete(schedules)
        .where(
          and(
            eq(schedules.siteId, site),
            eq(schedules.entryId, member.entryId),
            sql`exists (select 1 from ${entries} where ${atVersion})`,
          ),
        ),
      db
        .insert(schedules)
        .select(
          sql`select ${valuesOf(schedules, { ...row, groupId })} from ${entries} where ${atVersion}`,
        ),
      db
        .update(entries)
        .set({
          status: 'scheduled',
          scheduledAt: write.scheduledAt,
          version: sql`${entries.version} + 1`,
          updatedAt: now,
        })
        .where(atVersion),
    )
  })
  const ids = rows.map((row) => row.id)
  const missing = sql`(select count(*) from ${schedules} where ${and(eq(schedules.siteId, site), inArray(schedules.id, ids))}) < ${ids.length}`
  const guard = db
    .select({ failed: sql`json(${GUARD_FAILED})` })
    .from(sites)
    .where(and(eq(sites.id, site), missing))
  try {
    const [first, ...rest] = [...statements, guard]
    if (first !== undefined) await db.batch([first, ...rest])
  } catch (error) {
    if (!isGuardFailure(error)) throw error
    return refusalOf(db, site, write.members, error)
  }
  const views: EntryView[] = []
  for (const member of write.members) {
    const view = await findEntryById(db, site, member.entryId, 'head')
    if (view === null)
      throw new Error(`Entry ${member.entryId} is gone after its group was scheduled`)
    views.push(view)
  }
  return { outcome: 'scheduled', views }
}

async function refusalOf(
  db: Db,
  site: string,
  members: readonly { readonly entryId: string; readonly expectedVersion: number }[],
  error: unknown,
): Promise<WriteRefusal & { readonly entryId: string }> {
  for (const member of members) {
    const [row] = await db
      .select({ version: entries.version, headRev: entries.headRev, status: entries.status })
      .from(entries)
      .where(and(eq(entries.siteId, site), eq(entries.id, member.entryId)))
      .limit(1)
    if (row === undefined) return { outcome: 'not_found', entryId: member.entryId }
    if (row.version !== member.expectedVersion || row.status === 'published') {
      return {
        outcome: 'conflict',
        currentVersion: row.version,
        headRevision: row.headRev,
        entryId: member.entryId,
      }
    }
  }
  throw error
}

export async function groupSchedules(
  db: Db,
  site: string,
  groupId: string,
): Promise<readonly StoredSchedule[]> {
  const rows = await db
    .select()
    .from(schedules)
    .where(and(eq(schedules.siteId, site), eq(schedules.groupId, groupId)))
    .orderBy(schedules.id)
  return rows.map(storedSchedule)
}

function storedSchedule(row: typeof schedules.$inferSelect): StoredSchedule {
  return {
    entryId: row.entryId,
    scheduledAt: row.scheduledAt,
    version: row.version,
    group: row.groupId,
    acknowledged: parseAcknowledged(row.acknowledged),
    actor: {
      kind: actorKindOf(row.actorKind),
      userId: row.actorUserId,
      tokenId: row.actorTokenId,
      meta: row.actorMeta === null ? null : parseMeta(row.actorMeta),
    },
  }
}

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
  return rows.map(storedSchedule)
}

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

export function dropUnpublish(db: Db, site: string, entryId: string) {
  return db
    .delete(unpublishes)
    .where(and(eq(unpublishes.siteId, site), eq(unpublishes.entryId, entryId)))
}

export async function scheduleUnpublish(
  db: Db,
  clock: Clock,
  site: string,
  write: { readonly entryId: string; readonly at: string; readonly actor: Actor },
): Promise<'scheduled' | 'not_published' | 'not_found'> {
  const now = clock.now().toISOString()
  const published = and(
    eq(entries.id, write.entryId),
    eq(entries.siteId, site),
    eq(entries.status, 'published'),
    isNull(entries.deletedAt),
  )
  const row = {
    id: newId('unp'),
    siteId: site,
    entryId: write.entryId,
    unpublishAt: write.at,
    ...actorColumns(write.actor),
    createdAt: now,
    updatedAt: now,
  }
  const [, inserted] = await db.batch([
    dropUnpublish(db, site, write.entryId),
    db
      .insert(unpublishes)
      .select(sql`select ${valuesOf(unpublishes, row)} from ${entries} where ${published}`)
      .returning({ id: unpublishes.id }),
  ])
  if (inserted.length > 0) return 'scheduled'
  const [exists] = await db
    .select({ id: entries.id })
    .from(entries)
    .where(and(eq(entries.id, write.entryId), eq(entries.siteId, site), isNull(entries.deletedAt)))
  return exists === undefined ? 'not_found' : 'not_published'
}

export async function cancelUnpublish(db: Db, site: string, entryId: string): Promise<boolean> {
  const dropped = await dropUnpublish(db, site, entryId).returning({ id: unpublishes.id })
  return dropped.length > 0
}

export async function unpublishOf(db: Db, site: string, entryId: string): Promise<string | null> {
  const [row] = await db
    .select({ at: unpublishes.unpublishAt })
    .from(unpublishes)
    .where(and(eq(unpublishes.siteId, site), eq(unpublishes.entryId, entryId)))
  return row?.at ?? null
}

export async function dueUnpublishes(
  db: Db,
  site: string,
  now: string,
): Promise<readonly StoredUnpublish[]> {
  const rows = await db
    .select()
    .from(unpublishes)
    .where(and(eq(unpublishes.siteId, site), lte(unpublishes.unpublishAt, now)))
    .orderBy(unpublishes.unpublishAt)
    .limit(50)
  return rows.map((row) => ({
    entryId: row.entryId,
    unpublishAt: row.unpublishAt,
    actor: {
      kind: actorKindOf(row.actorKind),
      userId: row.actorUserId,
      tokenId: row.actorTokenId,
      meta: row.actorMeta === null ? null : parseMeta(row.actorMeta),
    },
  }))
}
