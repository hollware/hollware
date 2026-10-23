import type { Scope } from '@hollware/core'

export const ROLES = ['owner', 'editor', 'author'] as const

export type Role = (typeof ROLES)[number]

export function isRole(value: string): value is Role {
  return ROLES.some((role) => role === value)
}

export const ROLE_SCOPES: Readonly<Record<Role, readonly Scope[]>> = {
  owner: ['content:read', 'content:write', 'content:publish', 'schema:admin'],
  editor: ['content:read', 'content:write', 'content:publish'],
  author: ['content:read', 'content:write'],
}

export function effectiveScopes(role: string, tokenScopes: readonly Scope[]): Scope[] {
  if (!isRole(role)) return []
  return ROLE_SCOPES[role].filter((scope) => tokenScopes.includes(scope))
}

export function legacyRoleOf(role: Role): 'owner' | 'editor' | 'reviewer' {
  return role === 'author' ? 'reviewer' : role
}
