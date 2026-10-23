import { expect, it } from 'vite-plus/test'

import { base64url, challengeOf, randomValue } from '../app/lib/pkce.ts'

it('derives the challenge of the RFC 7636 example', async () => {
  expect(await challengeOf('dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk')).toBe(
    'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM',
  )
})

it('writes bytes as base64url without padding, and draws 32 random bytes by default', () => {
  expect(base64url(new Uint8Array([251, 255, 254]))).toBe('-__-')
  expect(base64url(new Uint8Array([1]))).toBe('AQ')
  expect(randomValue()).toMatch(/^[A-Za-z0-9_-]{43}$/)
})
