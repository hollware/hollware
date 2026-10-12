import type { Scope } from '@hollware/core'

/**
 * The roles of a user, as the `users_role` CHECK of the schema lists them. In v0.1 only the owner
 * exists: `hollware init` creates it. The other two are in the CHECK already, so that v0.3 can
 * invite people without a rebuild of the table (ADR-023).
 */
export const ROLES = ['owner', 'editor', 'reviewer'] as const

export type Role = (typeof ROLES)[number]

/** Whether a string is one of the roles. */
export function isRole(value: string): value is Role {
  return ROLES.some((role) => role === value)
}

/**
 * The scopes each role allows. What a token may do is its own scopes intersected with these,
 * read from the user's current role on every request (ADR-005, ADR-019). An operation asks for
 * scopes, never for a role.
 *
 * - `owner` may do everything: all four scopes.
 * - `editor` and `reviewer` allow none in v0.1. Nothing creates such a user yet, and which scopes
 *   each one gets (an editor writes, a reviewer approves) is for v0.3 to decide, together with
 *   the admin that invites them. Until then a token of such a user authenticates, but every
 *   operation answers 403 `insufficient_scope`.
 */
export const ROLE_SCOPES: Readonly<Record<Role, readonly Scope[]>> = {
  owner: ['content:read', 'content:write', 'content:publish', 'schema:admin'],
  editor: [],
  reviewer: [],
}

/**
 * The scopes a token really has: those it carries that the role of its user allows, in the order
 * of the role. A role that is not one of the roles allows nothing, so a role added to the schema
 * before this table knows it grants no access.
 */
export function effectiveScopes(role: string, tokenScopes: readonly Scope[]): Scope[] {
  if (!isRole(role)) return []
  return ROLE_SCOPES[role].filter((scope) => tokenScopes.includes(scope))
}
