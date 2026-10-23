import { describe, expect, it } from 'vite-plus/test'

import { missingScopes } from '../../src/auth/scopes.ts'
import type { Principal } from '../../src/auth/types.ts'

function tokenPrincipal(scopes: Principal['scopes']): Principal {
  return { kind: 'token', userId: 'usr_x', tokenId: 'tok_x', site: 'site-x', scopes }
}

describe('missingScopes', () => {
  it('lists the required scopes the principal lacks, in the order they are required', () => {
    const principal = tokenPrincipal(['content:write'])
    expect(missingScopes(principal, ['content:publish', 'content:write', 'content:read'])).toEqual([
      'content:publish',
      'content:read',
    ])
    expect(missingScopes(principal, ['content:read', 'content:write', 'content:publish'])).toEqual([
      'content:read',
      'content:publish',
    ])
  })

  it('lists nothing when the principal has every required scope, or none is required', () => {
    const principal = tokenPrincipal(['content:read', 'content:write'])
    expect(missingScopes(principal, ['content:write', 'content:read'])).toEqual([])
    expect(missingScopes(principal, [])).toEqual([])
  })

  it('lists everything a principal without scopes is asked for', () => {
    expect(missingScopes(tokenPrincipal([]), ['content:read', 'schema:admin'])).toEqual([
      'content:read',
      'schema:admin',
    ])
  })

  it('reads the scopes of a Worker bound over RPC like those of a token', () => {
    const binding: Principal = { kind: 'binding', scopes: ['content:read'] }
    expect(missingScopes(binding, ['content:read'])).toEqual([])
    expect(missingScopes(binding, ['content:read', 'content:write'])).toEqual(['content:write'])
  })
})
