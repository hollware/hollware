import { describe, expect, it } from 'vite-plus/test'

import { parseTokenScopes } from '../../src/auth/token.ts'

describe('parseTokenScopes', () => {
  it('reads the scopes of the JSON array the tokens table stores, in the order stored', () => {
    expect(parseTokenScopes('["content:write","content:read"]')).toEqual([
      'content:write',
      'content:read',
    ])
    expect(parseTokenScopes('[]')).toEqual([])
  })

  it('leaves out what is not one of the scopes', () => {
    expect(
      parseTokenScopes(
        '["content:read","content:delete",42,null,["content:write"],{"a":1},"Content:Read"]',
      ),
    ).toEqual(['content:read'])
  })

  it.each([
    ['an object', '{"scopes":["content:read"]}'],
    ['a string', '"content:read"'],
    ['a number', '1'],
    ['null', 'null'],
    ['text that is not JSON', 'content:read'],
    ['nothing', ''],
  ])('reads %s as no scopes at all', (_label, json) => {
    expect(parseTokenScopes(json)).toEqual([])
  })
})
