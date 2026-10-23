import { describe, expect, it } from 'vite-plus/test'

import { readBearerToken } from '../../src/auth/bearer.ts'

const TOKEN = `hw_pat_${'0'.repeat(52)}`

function requestWith(
  headers: Headers | Record<string, string>,
  url = 'https://cms.example.com/mcp',
) {
  return new Request(url, { headers })
}

describe('readBearerToken', () => {
  it.each([
    ['the scheme as the RFC spells it', `Bearer ${TOKEN}`],
    ['a lowercase scheme', `bearer ${TOKEN}`],
    ['an uppercase scheme', `BEARER ${TOKEN}`],
    ['several spaces after the scheme', `Bearer    ${TOKEN}`],
    ['spaces around the whole value', `  Bearer ${TOKEN}  `],
  ])('reads the token: %s', (_label, header) => {
    expect(readBearerToken(requestWith({ authorization: header }))).toBe(TOKEN)
  })

  it('returns the token as sent, whatever it is: judging it is the job of checkPersonalToken', () => {
    expect(readBearerToken(requestWith({ authorization: 'Bearer abc' }))).toBe('abc')
    expect(readBearerToken(requestWith({ authorization: 'Bearer HW_PAT_ABC' }))).toBe('HW_PAT_ABC')
  })

  it.each([
    ['no header', {}],
    ['an empty value', { authorization: '' }],
    ['another scheme', { authorization: 'Basic dXNlcjpwYXNz' }],
    ['a made-up scheme', { authorization: `Token ${TOKEN}` }],
    ['a scheme that only ends in Bearer', { authorization: `NotBearer ${TOKEN}` }],
    ['the token without a scheme', { authorization: TOKEN }],
    ['the scheme alone', { authorization: 'Bearer' }],
    ['the scheme and blanks', { authorization: 'Bearer    ' }],
    ['no space after the scheme', { authorization: `Bearer${TOKEN}` }],
    ['a tab after the scheme', { authorization: `Bearer\t${TOKEN}` }],
    ['two tokens', { authorization: `Bearer ${TOKEN} ${TOKEN}` }],
    ['a token and anything else', { authorization: `Bearer ${TOKEN} extra` }],
  ])('returns null for %s', (_label, headers) => {
    expect(readBearerToken(requestWith(headers))).toBeNull()
  })

  it('returns null for two Authorization headers, which arrive joined with a comma', () => {
    const headers = new Headers()
    headers.append('authorization', `Bearer ${TOKEN}`)
    headers.append('authorization', `Bearer ${TOKEN}`)
    expect(readBearerToken(requestWith(headers))).toBeNull()
  })

  it('never reads a token from the URL', () => {
    for (const query of ['access_token', 'token', 'authorization', 'bearer', 'key']) {
      const url = `https://cms.example.com/mcp?${query}=${TOKEN}`
      expect(readBearerToken(requestWith({}, url))).toBeNull()
    }
    const other = `hw_pat_${'1'.repeat(52)}`
    const both = requestWith(
      { authorization: `Bearer ${TOKEN}` },
      `https://cms.example.com/mcp?access_token=${other}`,
    )
    expect(readBearerToken(both)).toBe(TOKEN)
  })
})
