import { describe, expect, it } from 'vite-plus/test'

import { isScope, SCOPES } from '../src/scopes.ts'

describe('scopes', () => {
  it('are the four scopes of the design', () => {
    expect(SCOPES).toEqual(['content:read', 'content:write', 'content:publish', 'schema:admin'])
  })

  it('isScope accepts each of them and nothing else', () => {
    expect(SCOPES.filter((scope) => isScope(scope))).toEqual(SCOPES)
    for (const value of ['content', 'content:*', 'Content:read', 'content:read ', 'admin', '']) {
      expect(isScope(value)).toBe(false)
    }
  })
})
