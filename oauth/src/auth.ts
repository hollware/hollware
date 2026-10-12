/** The scopes of the design (docs/design.md): the catalogue the authorization server can grant. */
export const SCOPES = ['content:read', 'content:write', 'content:publish', 'schema:admin']

/** Everything the authorization server advertises in its metadata, `offline_access` included. */
export const SCOPES_SUPPORTED = [...SCOPES, 'offline_access']

/** What any access needs: named in the 401 challenge, so clients ask for it first. */
export const BASELINE_SCOPES = ['content:read']

/** The one user the spike's auto-approved consent signs in. */
export const SPIKE_USER_ID = 'usr_spike'

/** The data a grant stores (`completeAuthorization({ props })`) and the handler reads as `ctx.props`. */
export interface AuthProps {
  userId: string
  scopes: string[]
  via: 'oauth' | 'pat'
  tokenId?: string
}

/**
 * The fake of the D1 `users` table: the scopes the current role of each user grants. Authorization
 * checks scopes, never roles; a token is worth the scopes it carries that its user's role still has.
 */
export const ROLE_SCOPES: Record<string, string[]> = {
  usr_spike: [...SCOPES],
  usr_pat: [...SCOPES],
}

/** token ∩ current role: what a request may do. Unknown users may do nothing. */
export function effectiveScopes(userId: string, tokenScopes: string[]): string[] {
  const role = ROLE_SCOPES[userId] ?? []
  return tokenScopes.filter((scope) => role.includes(scope))
}
