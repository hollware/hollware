import { SCOPES, type Scope } from '@hollware/core'
import { describe, expect, it } from 'vite-plus/test'

import { effectiveScopes, isRole, ROLE_SCOPES, ROLES } from '../../src/auth/roles.ts'

describe('ROLE_SCOPES', () => {
  it('gives the owner every scope, an editor the content, and an author all but publishing', () => {
    expect(ROLES).toEqual(['owner', 'editor', 'author'])
    expect(ROLE_SCOPES).toEqual({
      owner: ['content:read', 'content:write', 'content:publish', 'schema:admin'],
      editor: ['content:read', 'content:write', 'content:publish'],
      author: ['content:read', 'content:write'],
    })
  })

  it('leaves out no scope of the catalog for the owner, so a new scope is a decision', () => {
    const left: Scope[] = SCOPES.filter((scope) => !ROLE_SCOPES.owner.includes(scope))
    expect(left).toEqual([])
  })
})

describe('isRole', () => {
  it('knows the roles and nothing else', () => {
    expect(ROLES.every((role) => isRole(role))).toBe(true)
    for (const other of ['', 'Owner', 'admin', 'constructor', '__proto__', 'toString']) {
      expect(isRole(other)).toBe(false)
    }
  })
})

describe('effectiveScopes', () => {
  it('keeps what the token carries and the role allows, in the order of the role', () => {
    expect(effectiveScopes('owner', ['content:write', 'content:read'])).toEqual([
      'content:read',
      'content:write',
    ])
    expect(effectiveScopes('owner', ['schema:admin'])).toEqual(['schema:admin'])
    expect(effectiveScopes('owner', [])).toEqual([])
  })

  it('lists a scope once, whatever the token says', () => {
    expect(effectiveScopes('owner', ['content:read', 'content:read'])).toEqual(['content:read'])
  })

  it('takes away what the role does not allow', () => {
    expect(effectiveScopes('editor', [...SCOPES])).toEqual([
      'content:read',
      'content:write',
      'content:publish',
    ])
    expect(effectiveScopes('author', [...SCOPES])).toEqual(['content:read', 'content:write'])
  })

  it('grants nothing to a role it does not know', () => {
    for (const role of ['admin', 'constructor', '__proto__', '']) {
      expect(effectiveScopes(role, [...SCOPES])).toEqual([])
    }
  })
})
