/**
 * The scopes a token carries. An operation asks for scopes, never for a role: what a token may
 * do is its own scopes intersected with those of its user's role.
 */
export const SCOPES = ['content:read', 'content:write', 'content:publish', 'schema:admin'] as const

export type Scope = (typeof SCOPES)[number]

/** Whether a string is one of the scopes. */
export function isScope(value: string): value is Scope {
  return SCOPES.some((scope) => scope === value)
}
