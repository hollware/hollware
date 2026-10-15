import {
  hashPersonalToken,
  isPersonalToken,
  isReadToken,
  isScope,
  type Scope,
} from '@hollware/core'
import { effectiveScopes } from './roles.ts'
import type { Principal } from './types.ts'

/**
 * Why a presented token is not accepted. For the log and the tests: the answer to the client is
 * the same for all three (`unauthorized`), so that nobody learns which tokens exist.
 */
export type TokenRejection = 'unknown' | 'expired' | 'revoked'

/** The principal of a personal token or of a read token. */
export type TokenPrincipal = Extract<Principal, { readonly kind: 'token' | 'read' }>

export type TokenCheck =
  | {
      readonly ok: true
      readonly principal: TokenPrincipal
      /**
       * The write of `last_used_at`, already started, or `null` when the token was used within
       * the last hour and nothing needs writing. It never rejects. Hand it to `ctx.waitUntil`:
       * Workers cancel a promise nobody waits for when the response is sent.
       */
      readonly touch: Promise<void> | null
    }
  | { readonly ok: false; readonly reason: TokenRejection }

export interface TokenCheckOptions {
  /** The sites this deployment serves. A token of any other site is `unknown`. */
  readonly sites: ReadonlySet<string>
  readonly now: Date
}

/** `last_used_at` of a token is written at most once in this time. */
const TOUCH_INTERVAL_MS = 60 * 60 * 1000

/**
 * The token with the role of its user in the token's site, by the hash of the token, in the
 * deployment. A user who is no member of the site has no role there, and the token is unknown.
 */
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

/**
 * The scopes a token carries, from the JSON array the `tokens` table stores. Anything that is not
 * one of the scopes is left out, and a value that is not an array of scopes has none: a token
 * never gets more than what the catalog names.
 */
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

/**
 * Whether an expiry has passed. A token is expired at the very instant of its expiry, and one
 * whose expiry cannot be read is expired too: the check fails closed. The expiry is read as an
 * instant, so any ISO 8601 spelling of it works, with or without milliseconds.
 */
function hasExpired(expiresAt: string | null, now: Date): boolean {
  if (expiresAt === null) return false
  const instant = Date.parse(expiresAt)
  return Number.isNaN(instant) || instant <= now.getTime()
}

/** The instant an hour before `now`, spelled as `last_used_at` is: ISO 8601 UTC with milliseconds. */
function anHourBefore(now: Date): string {
  return new Date(now.getTime() - TOUCH_INTERVAL_MS).toISOString()
}

/**
 * Writes `last_used_at` (and `updated_at`) of a token to `now`, unless it was written within the
 * hour before: the condition is in the `UPDATE`, so two requests that both read an old value
 * still write once. A failure is logged and swallowed: a statistic never fails the request, and
 * the returned promise never rejects, so nobody has to handle it.
 */
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

/**
 * Authenticates a personal token (ADR-019) or a read token. A string without the shape of either
 * is `unknown` without a query. Otherwise one query finds the token by the hash of the whole
 * string, together with the role of its user in the token's site; the answer is, in this order:
 *
 * - `unknown`: no such token in the sites of this deployment. A token of another site is the same as
 *   no token, and nothing says it exists elsewhere.
 * - `revoked`: it has a revocation date, whatever the date says: it is never read, so a clock that
 *   runs ahead of the Worker's, where the token was revoked, cannot keep it alive for a while.
 * - `expired`: its expiry is now or past (see `hasExpired`).
 * - `ok`: the principal, whose scopes are the token's own intersected with those of the role its
 *   user has now. A token whose user has no scopes (an editor, in v0.1) still authenticates, and
 *   every operation then answers `insufficient_scope`.
 *
 * Pass the `D1Database` binding itself and not a replica session: a token that was revoked must
 * stop working on the next request, and only the primary knows. A D1 failure rejects, and a caller
 * must never read that as a valid token.
 */
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
  // A row of the other kind is no token of this one: the prefix and the row must agree.
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
