import type { Scope } from '@hollware/core'

/**
 * The roles of a user, as the `users_role` CHECK of the schema lists them (ADR-026): the owner,
 * whom `hollware init` creates, and the editors and authors whom invitations bring in.
 */
export const ROLES = ['owner', 'editor', 'author'] as const

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
 * - `editor` reads, writes and publishes.
 * - `author` reads and writes; what an author publishes goes through review (v0.3).
 */
export const ROLE_SCOPES: Readonly<Record<Role, readonly Scope[]>> = {
  owner: ['content:read', 'content:write', 'content:publish', 'schema:admin'],
  editor: ['content:read', 'content:write', 'content:publish'],
  author: ['content:read', 'content:write'],
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
