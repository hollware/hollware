import { hashPersonalToken } from '@hollware/core'
import { effectiveScopes } from './roles.ts'
import { hasExpired, parseTokenScopes, type TokenCheck, type TokenCheckOptions } from './token.ts'

const LOOKUP = `SELECT g.id AS grant_id, g.site_id AS site_id, g.user_id AS user_id, g.agent AS agent,
    g.review_id AS review_id, g.scopes AS scopes, g.expires_at AS expires_at,
    g.revoked_at AS revoked_at, m.role AS role, u.kind AS user_kind, r.status AS review_status
  FROM agent_grants AS g
  JOIN members AS m ON m.user_id = g.user_id AND m.site_id = g.site_id
  JOIN users AS u ON u.id = g.user_id
  LEFT JOIN reviews AS r ON r.id = g.review_id AND r.site_id = g.site_id
  WHERE g.hash = ?1`

interface GrantRow {
  readonly grant_id: string
  readonly site_id: string
  readonly user_id: string
  readonly agent: string
  readonly review_id: string | null
  readonly scopes: string
  readonly expires_at: string
  readonly revoked_at: string | null
  readonly role: string
  readonly user_kind: string
  readonly review_status: string | null
}

export async function checkAgentGrant(
  db: D1Database,
  token: string,
  options: TokenCheckOptions,
): Promise<TokenCheck> {
  const row = await db
    .prepare(LOOKUP)
    .bind(await hashPersonalToken(token))
    .first<GrantRow>()
  if (row === null || row.user_kind !== 'agent' || !options.sites.has(row.site_id)) {
    return { ok: false, reason: 'unknown' }
  }
  if (row.revoked_at !== null) return { ok: false, reason: 'revoked' }
  if (row.review_id !== null && row.review_status !== 'pending') {
    return { ok: false, reason: 'revoked' }
  }
  if (hasExpired(row.expires_at, options.now)) return { ok: false, reason: 'expired' }
  return {
    ok: true,
    principal: {
      kind: 'token',
      userId: row.user_id,
      tokenId: row.grant_id,
      site: row.site_id,
      scopes: effectiveScopes(row.role, parseTokenScopes(row.scopes)),
      agent: { name: row.agent, review: row.review_id },
    },
    touch: null,
  }
}
