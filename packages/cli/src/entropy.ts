import {
  generatePersonalToken,
  generateReadToken,
  ID_PREFIXES,
  ulid,
  type IdPrefix,
} from '@hollware/core'
import type { Io } from './io.ts'

export function newId(io: Pick<Io, 'now' | 'randomBytes'>, kind: keyof typeof ID_PREFIXES): string {
  const prefix: IdPrefix = ID_PREFIXES[kind]
  return `${prefix}_${ulid(io.now().getTime(), io.randomBytes(10))}`
}

export function newPersonalToken(io: Pick<Io, 'randomBytes'>): string {
  return generatePersonalToken(io.randomBytes(52))
}

export function newReadToken(io: Pick<Io, 'randomBytes'>): string {
  return generateReadToken(io.randomBytes(52))
}

const DAY_MS = 86_400_000

export function inDays(from: Date, days: number): string {
  return new Date(from.getTime() + days * DAY_MS).toISOString()
}

export function newInvitationSecret(io: Pick<Io, 'randomBytes'>): string {
  let binary = ''
  for (const byte of io.randomBytes(32)) binary += String.fromCharCode(byte)
  return `hw_inv_${btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')}`
}

export const INVITATION_TTL_DAYS = 7
