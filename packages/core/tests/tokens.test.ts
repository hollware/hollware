import { describe, expect, it } from 'vite-plus/test'

import {
  generatePersonalToken,
  hashPersonalToken,
  isPersonalToken,
  PERSONAL_TOKEN_PREFIX,
  PERSONAL_TOKEN_TTL_DAYS,
} from '../src/tokens.ts'

// Fails when: a personal token stops being `hw_pat_` and 52 characters of lowercase Crockford
// base 32 (one per random byte, from its low 5 bits), the shape check accepts something else, the
// hash stops being the hex SHA-256 of the whole token, or the default lifetime moves from 90 days.

const ZERO_TOKEN = `hw_pat_${'0'.repeat(52)}`

describe('personal tokens', () => {
  it('turns each random byte into one character, from its low 5 bits', () => {
    expect(PERSONAL_TOKEN_PREFIX).toBe('hw_pat_')
    expect(generatePersonalToken(new Uint8Array(52))).toBe(ZERO_TOKEN)
    expect(generatePersonalToken(new Uint8Array(52).fill(255))).toBe(`hw_pat_${'z'.repeat(52)}`)
    // 32 is 0b100000: its low 5 bits are zero, so the high bits never leak into the character.
    expect(generatePersonalToken(new Uint8Array(52).fill(32))).toBe(ZERO_TOKEN)
    const counting = Uint8Array.from({ length: 52 }, (_, index) => index)
    expect(generatePersonalToken(counting)).toBe(
      'hw_pat_0123456789abcdefghjkmnpqrstvwxyz0123456789abcdefghjk',
    )
  })

  it('refuses randomness of any other length', () => {
    expect(() => generatePersonalToken(new Uint8Array(51))).toThrow(
      new RangeError('a personal token takes 52 random bytes, got 51'),
    )
  })

  it('makes a different token each time from fresh randomness', () => {
    const first = generatePersonalToken()
    expect(isPersonalToken(first)).toBe(true)
    expect(generatePersonalToken()).not.toBe(first)
  })

  it('recognizes the shape and nothing else', () => {
    expect(isPersonalToken(ZERO_TOKEN)).toBe(true)
    expect(isPersonalToken(`hw_pat_${'0'.repeat(51)}`)).toBe(false)
    expect(isPersonalToken(`hw_pat_${'0'.repeat(53)}`)).toBe(false)
    expect(isPersonalToken(`hw_tok_${'0'.repeat(52)}`)).toBe(false)
    expect(isPersonalToken(`HW_PAT_${'0'.repeat(52)}`)).toBe(false)
    // Crockford leaves out i, l, o and u; the alphabet is lowercase.
    for (const letter of ['i', 'l', 'o', 'u', 'A']) {
      expect(isPersonalToken(`hw_pat_${letter}${'0'.repeat(51)}`)).toBe(false)
    }
    expect(isPersonalToken(` ${ZERO_TOKEN}`)).toBe(false)
  })

  it('hashes the whole token with SHA-256, in lowercase hex', async () => {
    expect(await hashPersonalToken('abc')).toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    )
    expect(await hashPersonalToken(ZERO_TOKEN)).toBe(
      '664e24a041fe85a5429d35fc3e30b28e149f0f9b7a2b7b1b2378e89022b21d07',
    )
  })

  it('expires after 90 days unless asked otherwise', () => {
    expect(PERSONAL_TOKEN_TTL_DAYS).toBe(90)
  })
})
