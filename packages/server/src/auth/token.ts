import {
  hashPersonalToken,
  isPersonalToken,
  isReadToken,
  isScope,
  type Scope,
} from '@hollware/core'
import { effectiveScopes } from './roles.ts'
import type { Principal } from './types.ts'

export type TokenRejection = 'unknown' | 'expired' | 'revoked'

export type TokenPrincipal = Extract<Principal, { readonly kind: 'token' | 'read' }>

export type TokenCheck =
  | {
      readonly ok: true
      readonly principal: TokenPrincipal
      readonly touch: Promise<void> | null
    }
  | { readonly ok: false; readonly reason: TokenRejection }

export interface TokenCheckOptions {
  readonly sites: ReadonlySet<string>
  readonly now: Date
}

const TOUCH_INTERVAL_MS = 60 * 60 * 1000

const LOOKUP = `SELECT t.id AS token_id, t.site_id AS site_id, t.user_id AS user_id,
    t.kind AS kind, t.scopes AS scopes, t.expires_at AS expires_at, t.revoked_at AS revoked_at,
    t.last_used_at AS last_used_at, m.role AS role
  FROM tokens AS t JOIN members AS m ON m.user_id = t.user_id AND m.site_id = t.site_id
  WHERE t.hash = ?1`

interface TokenRow {
  readonly token_id: string
  readonly site_id: string
  readonly user_id: string
  readonly kind: string
  readonly scopes: string
  readonly expires_at: string | null
  readonly revoked_at: string | null
  readonly last_used_at: string | null
  readonly role: string
}

export function parseTokenScopes(json: string): Scope[] {
  let parsed: unknown
  try {
    parsed = JSON.parse(json)
  } catch {
    return []
  }
  if (!Array.isArray(parsed)) return []
  return parsed.filter((value): value is Scope => typeof value === 'string' && isScope(value))
}

export function hasExpired(expiresAt: string | null, now: Date): boolean {
  if (expiresAt === null) return false
  const instant = Date.parse(expiresAt)
  return Number.isNaN(instant) || instant <= now.getTime()
}

function anHourBefore(now: Date): string {
  return new Date(now.getTime() - TOUCH_INTERVAL_MS).toISOString()
}

export async function recordTokenUse(
  db: D1Database,
  token: { readonly id: string; readonly site: string },
  now: Date,
): Promise<void> {
  try {
    await db
      .prepare(
        `UPDATE tokens SET last_used_at = ?1, updated_at = ?1
          WHERE id = ?2 AND site_id = ?3 AND (last_used_at IS NULL OR last_used_at < ?4)`,
      )
      .bind(now.toISOString(), token.id, token.site, anHourBefore(now))
      .run()
  } catch (error) {
    console.error('hollware: could not record the last use of a token', error)
  }
}

export async function checkPersonalToken(
  db: D1Database,
  token: string,
  options: TokenCheckOptions,
): Promise<TokenCheck> {
  const kind = isPersonalToken(token) ? 'personal' : isReadToken(token) ? 'read' : null
  if (kind === null) return { ok: false, reason: 'unknown' }
  const row = await db
    .prepare(LOOKUP)
    .bind(await hashPersonalToken(token))
    .first<TokenRow>()
  if (row === null || row.kind !== kind || !options.sites.has(row.site_id)) {
    return { ok: false, reason: 'unknown' }
  }
  if (row.revoked_at !== null) return { ok: false, reason: 'revoked' }
  if (hasExpired(row.expires_at, options.now)) return { ok: false, reason: 'expired' }
  const recent = row.last_used_at !== null && row.last_used_at >= anHourBefore(options.now)
  const scopes = effectiveScopes(row.role, parseTokenScopes(row.scopes))
  const identity = { userId: row.user_id, tokenId: row.token_id, site: row.site_id }
  return {
    ok: true,
    principal:
      kind === 'read'
        ? { kind: 'read', ...identity, scopes: scopes.filter((scope) => scope === 'content:read') }
        : { kind: 'token', ...identity, scopes },
    touch: recent ? null : recordTokenUse(db, { id: row.token_id, site: row.site_id }, options.now),
  }
}
