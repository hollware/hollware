import { newId } from '@hollware/core'
import { and, eq, gt, isNull, lte } from 'drizzle-orm'
import type { Db } from '../db/d1.ts'
import { authChallenges, invitations, passkeys, sessions, users } from '../db/schema.ts'
import { hashSecret, newSecret } from './secrets.ts'

/** The D1 side of identity (ADR-026). Each write that must happen once is one conditional statement. */

export type Role = 'owner' | 'editor' | 'author'

export interface Invitation {
  readonly id: string
  readonly role: Role
  readonly userId: string | null
}

function roleOf(value: string): Role {
  if (value === 'owner' || value === 'editor' || value === 'author') return value
  throw new Error(`An invitation has the role ${value}, which the schema does not allow`)
}

/** Creates a link that lets one person in, and gives its secret, which is never stored. */
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

/** The invitation of a secret, while it is unused and has not expired. */
export async function findInvitation(
  db: Db,
  site: string,
  secret: string,
  now: Date,
): Promise<Invitation | null> {
  const [row] = await db
    .select({ id: invitations.id, role: invitations.role, userId: invitations.userId })
    .from(invitations)
    .where(
      and(
        eq(invitations.siteId, site),
        eq(invitations.hash, await hashSecret(secret)),
        isNull(invitations.usedAt),
        gt(invitations.expiresAt, now.toISOString()),
      ),
    )
    .limit(1)
  return row === undefined ? null : { ...row, role: roleOf(row.role) }
}

/** Uses an invitation, once: `false` when it was used already or has expired. */
export async function redeemInvitation(
  db: Db,
  site: string,
  id: string,
  now: Date,
): Promise<boolean> {
  const at = now.toISOString()
  const rows = await db
    .update(invitations)
    .set({ usedAt: at, updatedAt: at })
    .where(
      and(
        eq(invitations.siteId, site),
        eq(invitations.id, id),
        isNull(invitations.usedAt),
        gt(invitations.expiresAt, at),
      ),
    )
    .returning({ id: invitations.id })
  return rows.length === 1
}

/** Keeps a WebAuthn challenge for five minutes. */
export async function saveChallenge(
  db: Db,
  input: {
    site: string
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
    siteId: input.site,
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

/** Takes a challenge, once, if it has the purpose asked and has not expired. */
export async function takeChallenge(
  db: Db,
  input: { site: string; id: string; purpose: 'register' | 'authenticate'; now: Date },
) {
  const [row] = await db
    .delete(authChallenges)
    .where(and(eq(authChallenges.siteId, input.site), eq(authChallenges.id, input.id)))
    .returning()
  if (row === undefined || row.purpose !== input.purpose) return null
  if (row.expiresAt <= input.now.toISOString()) return null
  return row
}

export async function passkeysOf(db: Db, site: string, userId: string) {
  return db
    .select()
    .from(passkeys)
    .where(and(eq(passkeys.siteId, site), eq(passkeys.userId, userId)))
}

export async function findPasskey(db: Db, site: string, credentialId: string) {
  const [row] = await db
    .select()
    .from(passkeys)
    .where(and(eq(passkeys.siteId, site), eq(passkeys.credentialId, credentialId)))
    .limit(1)
  return row ?? null
}

/** Records a sign-in with a passkey: its new counter, and when. */
export async function touchPasskey(db: Db, id: string, counter: number, now: Date) {
  const at = now.toISOString()
  await db
    .update(passkeys)
    .set({ counter, lastUsedAt: at, updatedAt: at })
    .where(eq(passkeys.id, id))
}

/** Makes the person of a new invitation, with its role. */
export async function createUser(
  db: Db,
  input: { id: string; name: string; role: Role; now: Date },
): Promise<void> {
  const at = input.now.toISOString()
  await db
    .insert(users)
    .values({ id: input.id, name: input.name, role: input.role, createdAt: at, updatedAt: at })
}

export async function addPasskey(
  db: Db,
  input: {
    site: string
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
    siteId: input.site,
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

/** Opens a session for a person, and gives the secret of its cookie, which is never stored. */
export async function createSession(
  db: Db,
  input: { site: string; userId: string; now: Date; hours: number },
): Promise<{ secret: string; expiresAt: string }> {
  const secret = newSecret('hw_ses')
  const at = input.now.toISOString()
  const expiresAt = new Date(input.now.getTime() + input.hours * 3_600_000).toISOString()
  await db.insert(sessions).values({
    id: newId('ses'),
    siteId: input.site,
    userId: input.userId,
    hash: await hashSecret(secret),
    expiresAt,
    createdAt: at,
    updatedAt: at,
  })
  return { secret, expiresAt }
}

/** The person of a session cookie, while it lasts, with their role now. */
export async function findSession(db: Db, site: string, secret: string, now: Date) {
  const [row] = await db
    .select({ userId: sessions.userId, name: users.name, role: users.role })
    .from(sessions)
    .innerJoin(users, eq(users.id, sessions.userId))
    .where(
      and(
        eq(sessions.siteId, site),
        eq(sessions.hash, await hashSecret(secret)),
        gt(sessions.expiresAt, now.toISOString()),
      ),
    )
    .limit(1)
  return row ?? null
}

/** Drops the sessions that have expired; the cron trigger calls it. */
export async function dropExpiredSessions(db: Db, now: Date): Promise<void> {
  await db.delete(sessions).where(lte(sessions.expiresAt, now.toISOString()))
}

/** An invitation by its id, used or not: what a registration redeems. */
export async function invitationById(db: Db, site: string, id: string): Promise<Invitation | null> {
  const [row] = await db
    .select({ id: invitations.id, role: invitations.role, userId: invitations.userId })
    .from(invitations)
    .where(and(eq(invitations.siteId, site), eq(invitations.id, id)))
    .limit(1)
  return row === undefined ? null : { ...row, role: roleOf(row.role) }
}
