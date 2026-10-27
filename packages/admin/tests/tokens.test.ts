import { describe, expect, it } from 'vite-plus/test'
import { tokenRequest } from '../app/lib/tokens.ts'

const PERSONAL = {
  label: 'Agent',
  read: false,
  scopes: ['content:read', 'content:write'],
  days: undefined,
  never: false,
}

describe('the request that makes a token', () => {
  it('leaves the days to the server for a personal token, which then expires after 90', () => {
    expect(tokenRequest(PERSONAL)).toEqual({
      label: 'Agent',
      scopes: ['content:read', 'content:write'],
    })
  })

  it('asks for the days given, and for no expiry only when the person ticks it', () => {
    expect(tokenRequest({ ...PERSONAL, days: 30 })).toEqual({
      label: 'Agent',
      scopes: ['content:read', 'content:write'],
      expiresInDays: 30,
    })
    expect(tokenRequest({ ...PERSONAL, days: 30, never: true })).toEqual({
      label: 'Agent',
      scopes: ['content:read', 'content:write'],
      expiresInDays: null,
    })
  })

  it('makes a read token with no scopes of its own, and ignores the tick of no expiry', () => {
    expect(tokenRequest({ ...PERSONAL, label: 'Site', read: true, never: true })).toEqual({
      label: 'Site',
      kind: 'read',
    })
    expect(tokenRequest({ ...PERSONAL, label: 'Site', read: true, days: 7 })).toEqual({
      label: 'Site',
      kind: 'read',
      expiresInDays: 7,
    })
  })

  it('sends no days for a field left empty, at zero or with a fraction', () => {
    for (const days of [undefined, 0, -3, 2.5]) {
      expect(tokenRequest({ ...PERSONAL, days })).not.toHaveProperty('expiresInDays')
    }
  })
})
