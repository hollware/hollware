import {
  generatePersonalToken,
  generateReadToken,
  ID_PREFIXES,
  ulid,
  type IdPrefix,
} from '@hollware/core'
import type { Io } from './io.ts'

/** A new id of a kind, such as `usr_01JAB…`, from the clock and the random source of `io`. */
export function newId(io: Pick<Io, 'now' | 'randomBytes'>, kind: keyof typeof ID_PREFIXES): string {
  const prefix: IdPrefix = ID_PREFIXES[kind]
  return `${prefix}_${ulid(io.now().getTime(), io.randomBytes(10))}`
}

/** A new personal token (`hw_pat_` and 52 characters) from the random source of `io`. */
export function newPersonalToken(io: Pick<Io, 'randomBytes'>): string {
  return generatePersonalToken(io.randomBytes(52))
}

/** A new read token (`hw_read_`), from the same randomness. */
export function newReadToken(io: Pick<Io, 'randomBytes'>): string {
  return generateReadToken(io.randomBytes(52))
}

const DAY_MS = 86_400_000

/** The moment, in ISO 8601 UTC, that is `days` days after `from`. */
export function inDays(from: Date, days: number): string {
  return new Date(from.getTime() + days * DAY_MS).toISOString()
}

/** A new invitation secret (`hw_inv_` and 43 base64url characters) from the random source of `io`. */
export function newInvitationSecret(io: Pick<Io, 'randomBytes'>): string {
  let binary = ''
  for (const byte of io.randomBytes(32)) binary += String.fromCharCode(byte)
  return `hw_inv_${btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')}`
}

/** How long a setup link or an invitation stays valid, by default. */
export const INVITATION_TTL_DAYS = 7
