import { describe, expect, it } from 'vite-plus/test'

import {
  generatePersonalToken,
  generateReadToken,
  hashPersonalToken,
  isPersonalToken,
  isReadToken,
  PERSONAL_TOKEN_PREFIX,
  PERSONAL_TOKEN_TTL_DAYS,
  READ_TOKEN_PREFIX,
} from '../src/tokens.ts'

const ZERO_TOKEN = `hw_pat_${'0'.repeat(52)}`

describe('personal tokens', () => {
  it('turns each random byte into one character, from its low 5 bits', () => {
    expect(PERSONAL_TOKEN_PREFIX).toBe('hw_pat_')
    expect(generatePersonalToken(new Uint8Array(52))).toBe(ZERO_TOKEN)
    expect(generatePersonalToken(new Uint8Array(52).fill(255))).toBe(`hw_pat_${'z'.repeat(52)}`)
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

describe('read tokens', () => {
  it('are hw_read_ and the same 52 characters, and neither shape takes the other', () => {
    const counting = Uint8Array.from({ length: 52 }, (_, index) => index)
    const read = generateReadToken(counting)

    expect(READ_TOKEN_PREFIX).toBe('hw_read_')
    expect(read).toBe('hw_read_0123456789abcdefghjkmnpqrstvwxyz0123456789abcdefghjk')
    expect([isReadToken(read), isPersonalToken(read)]).toEqual([true, false])
    expect([isReadToken(ZERO_TOKEN), isReadToken(`hw_read_${'0'.repeat(51)}`)]).toEqual([
      false,
      false,
    ])
    expect(() => generateReadToken(new Uint8Array(53))).toThrow(
      new RangeError('a read token takes 52 random bytes, got 53'),
    )
  })
})
