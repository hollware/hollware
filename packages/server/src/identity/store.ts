import { newId } from '@hollware/core'
import { and, eq, gt, isNull, lte } from 'drizzle-orm'
import type { Db } from '../db/d1.ts'
import { legacyRoleOf } from '../auth/roles.ts'
import { authChallenges, invitations, members, passkeys, sessions, users } from '../db/schema.ts'
import { hashSecret, newSecret } from './secrets.ts'

export type Role = 'owner' | 'editor' | 'author'

export interface Invitation {
  readonly id: string
  readonly site: string
  readonly role: Role
  readonly userId: string | null
}

function roleOf(value: string): Role {
  if (value === 'owner' || value === 'editor' || value === 'author') return value
  throw new Error(`A role of ${value} is no role the schema allows`)
}

export async function createInvitation(
  db: Db,
  input: { site: string; role: Role; userId: string | null; now: Date; days: number },
): Promise<{ id: string; secret: string; expiresAt: string }> {
  const secret = newSecret('hw_inv')
  const id = newId('inv')
  const now = input.now.toISOString()
  const expiresAt = new Date(input.now.getTime() + input.days * 86_400_000).toISOString()
  await db.insert(invitations).values({
    id,
    siteId: input.site,
    hash: await hashSecret(secret),
    role: input.role,
    userId: input.userId,
    expiresAt,
    usedAt: null,
    createdAt: now,
    updatedAt: now,
  })
  return { id, secret, expiresAt }
}

export async function findInvitation(
  db: Db,
  secret: string,
  now: Date,
): Promise<Invitation | null> {
  const [row] = await db
    .select({
      id: invitations.id,
      site: invitations.siteId,
      role: invitations.role,
      userId: invitations.userId,
    })
    .from(invitations)
    .where(
      and(
        eq(invitations.hash, await hashSecret(secret)),
        isNull(invitations.usedAt),
        gt(invitations.expiresAt, now.toISOString()),
      ),
    )
    .limit(1)
  return row === undefined ? null : { ...row, role: roleOf(row.role) }
}

export async function revokeInvitation(
  db: Db,
  input: { site: string; id: string; now: Date },
): Promise<boolean> {
  const at = input.now.toISOString()
  const rows = await db
    .update(invitations)
    .set({ expiresAt: at, updatedAt: at })
    .where(
      and(
        eq(invitations.id, input.id),
        eq(invitations.siteId, input.site),
        isNull(invitations.usedAt),
        gt(invitations.expiresAt, at),
      ),
    )
    .returning({ id: invitations.id })
  return rows.length === 1
}

export async function redeemInvitation(db: Db, id: string, now: Date): Promise<boolean> {
  const at = now.toISOString()
  const rows = await db
    .update(invitations)
    .set({ usedAt: at, updatedAt: at })
    .where(and(eq(invitations.id, id), isNull(invitations.usedAt), gt(invitations.expiresAt, at)))
    .returning({ id: invitations.id })
  return rows.length === 1
}

export async function saveChallenge(
  db: Db,
  input: {
    challenge: string
    purpose: 'register' | 'authenticate'
    invitationId: string | null
    userId: string | null
    now: Date
  },
): Promise<string> {
  const id = newId('chl')
  const now = input.now.toISOString()
  await db.insert(authChallenges).values({
    id,
    challenge: input.challenge,
    purpose: input.purpose,
    invitationId: input.invitationId,
    userId: input.userId,
    expiresAt: new Date(input.now.getTime() + 300_000).toISOString(),
    createdAt: now,
    updatedAt: now,
  })
  return id
}

export async function takeChallenge(
  db: Db,
  input: { id: string; purpose: 'register' | 'authenticate'; now: Date },
) {
  const [row] = await db.delete(authChallenges).where(eq(authChallenges.id, input.id)).returning()
  if (row === undefined || row.purpose !== input.purpose) return null
  if (row.expiresAt <= input.now.toISOString()) return null
  return row
}

export async function passkeysOf(db: Db, userId: string) {
  return db.select().from(passkeys).where(eq(passkeys.userId, userId))
}

export async function findPasskey(db: Db, credentialId: string) {
  const [row] = await db
    .select()
    .from(passkeys)
    .where(eq(passkeys.credentialId, credentialId))
    .limit(1)
  return row ?? null
}

export async function touchPasskey(db: Db, id: string, counter: number, now: Date) {
  const at = now.toISOString()
  await db
    .update(passkeys)
    .set({ counter, lastUsedAt: at, updatedAt: at })
    .where(eq(passkeys.id, id))
}

export async function createUser(
  db: Db,
  input: { id: string; name: string; role: Role; site: string; now: Date },
): Promise<void> {
  const at = input.now.toISOString()
  await db.batch([
    db.insert(users).values({
      id: input.id,
      name: input.name,
      role: legacyRoleOf(input.role),
      createdAt: at,
      updatedAt: at,
    }),
    db.insert(members).values({
      id: newId('mbr'),
      siteId: input.site,
      userId: input.id,
      role: input.role,
      createdAt: at,
      updatedAt: at,
    }),
  ])
}

export async function addPasskey(
  db: Db,
  input: {
    userId: string
    credentialId: string
    publicKey: string
    counter: number
    transports: readonly string[]
    label: string
    now: Date
  },
): Promise<void> {
  const at = input.now.toISOString()
  await db.insert(passkeys).values({
    id: newId('pky'),
    userId: input.userId,
    credentialId: input.credentialId,
    publicKey: input.publicKey,
    counter: input.counter,
    transports: JSON.stringify(input.transports),
    label: input.label,
    lastUsedAt: null,
    createdAt: at,
    updatedAt: at,
  })
}

export async function createSession(
  db: Db,
  input: { userId: string; now: Date; hours: number },
): Promise<{ secret: string; expiresAt: string }> {
  const secret = newSecret('hw_ses')
  const at = input.now.toISOString()
  const expiresAt = new Date(input.now.getTime() + input.hours * 3_600_000).toISOString()
  await db.insert(sessions).values({
    id: newId('ses'),
    userId: input.userId,
    hash: await hashSecret(secret),
    expiresAt,
    createdAt: at,
    updatedAt: at,
  })
  return { secret, expiresAt }
}

export async function findSession(db: Db, secret: string, now: Date) {
  const [row] = await db
    .select({ userId: sessions.userId, name: users.name })
    .from(sessions)
    .innerJoin(users, eq(users.id, sessions.userId))
    .where(
      and(eq(sessions.hash, await hashSecret(secret)), gt(sessions.expiresAt, now.toISOString())),
    )
    .limit(1)
  return row ?? null
}

export interface PasskeySummary {
  readonly id: string
  readonly label: string
  readonly createdAt: string
  readonly lastUsedAt: string | null
}

export async function passkeySummaries(db: Db, userId: string): Promise<PasskeySummary[]> {
  return db
    .select({
      id: passkeys.id,
      label: passkeys.label,
      createdAt: passkeys.createdAt,
      lastUsedAt: passkeys.lastUsedAt,
    })
    .from(passkeys)
    .where(eq(passkeys.userId, userId))
    .orderBy(passkeys.createdAt, passkeys.id)
}

export const MAX_NAME_LENGTH = 100

export function cleanName(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const clean = value.trim().replace(/\s+/g, ' ')
  // oxlint-disable-next-line no-control-regex -- control characters are what it refuses
  if (clean === '' || clean.length > MAX_NAME_LENGTH || /[\u0000-\u001f\u007f]/.test(clean)) {
    return null
  }
  return clean
}

export async function renameUser(db: Db, userId: string, name: string): Promise<void> {
  await db.update(users).set({ name }).where(eq(users.id, userId))
}

export async function renamePasskey(
  db: Db,
  input: { readonly userId: string; readonly id: string; readonly label: string },
): Promise<boolean> {
  const renamed = await db
    .update(passkeys)
    .set({ label: input.label })
    .where(and(eq(passkeys.id, input.id), eq(passkeys.userId, input.userId)))
    .returning({ id: passkeys.id })
  return renamed.length === 1
}

export type PasskeyRemoval = 'removed' | 'not_found' | 'last'

export async function removePasskey(
  db: D1Database,
  input: { readonly userId: string; readonly id: string },
): Promise<PasskeyRemoval> {
  const result = await db
    .prepare(
      `DELETE FROM passkeys WHERE id = ?1 AND user_id = ?2
       AND (SELECT count(*) FROM passkeys WHERE user_id = ?2) > 1`,
    )
    .bind(input.id, input.userId)
    .run()
  if (result.meta.changes === 1) return 'removed'
  const mine = await db
    .prepare('SELECT 1 AS found FROM passkeys WHERE id = ?1 AND user_id = ?2')
    .bind(input.id, input.userId)
    .first<{ found: number }>()
  return mine === null ? 'not_found' : 'last'
}

export async function endSession(db: Db, secret: string): Promise<string | null> {
  const [ended] = await db
    .delete(sessions)
    .where(eq(sessions.hash, await hashSecret(secret)))
    .returning({ userId: sessions.userId })
  return ended?.userId ?? null
}

export async function endSessions(db: Db, userId: string): Promise<number> {
  const ended = await db
    .delete(sessions)
    .where(eq(sessions.userId, userId))
    .returning({ id: sessions.id })
  return ended.length
}

export async function membershipsOf(
  db: Db,
  userId: string,
): Promise<readonly { readonly site: string; readonly role: Role }[]> {
  const rows = await db
    .select({ site: members.siteId, role: members.role })
    .from(members)
    .where(eq(members.userId, userId))
    .orderBy(members.createdAt, members.siteId)
  return rows.map((row) => ({ site: row.site, role: roleOf(row.role) }))
}

export async function dropExpired(db: Db, now: Date): Promise<void> {
  const at = now.toISOString()
  await db.batch([
    db.delete(sessions).where(lte(sessions.expiresAt, at)),
    db.delete(authChallenges).where(lte(authChallenges.expiresAt, at)),
  ])
}

export async function invitationById(db: Db, id: string): Promise<Invitation | null> {
  const [row] = await db
    .select({
      id: invitations.id,
      site: invitations.siteId,
      role: invitations.role,
      userId: invitations.userId,
    })
    .from(invitations)
    .where(eq(invitations.id, id))
    .limit(1)
  return row === undefined ? null : { ...row, role: roleOf(row.role) }
}
