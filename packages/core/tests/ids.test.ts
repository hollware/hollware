import { describe, expect, it } from 'vite-plus/test'

import { isId, newId, ulid } from '../src/ids.ts'

// Fails when: ulid() stops encoding the time in its first 10 characters (Crockford base 32, most
// significant first), stops encoding the 80 random bits in the last 16, accepts a time or a
// randomness it cannot encode, or newId()/isId() stop agreeing on the `prefix_ULID` shape.

describe('ulid', () => {
  it('encodes the time of the ULID specification examples in its first 10 characters', () => {
    // From the ULID specification: ulid(1469918176385) starts 01ARYZ6S41, and its other example,
    // 01ARZ3NDEK…, is the time 1469922850259.
    expect(ulid(1469918176385, new Uint8Array(10)).slice(0, 10)).toBe('01ARYZ6S41')
    expect(ulid(1469922850259, new Uint8Array(10)).slice(0, 10)).toBe('01ARZ3NDEK')
  })

  it('encodes the random bytes, most significant bit first, in its last 16 characters', () => {
    expect(ulid(0, new Uint8Array(10))).toBe('00000000000000000000000000')
    expect(ulid(0, new Uint8Array(10).fill(255))).toBe('0000000000ZZZZZZZZZZZZZZZZ')
    // 0x80 then nine zero bytes: the first 5 bits are 10000 (16 → G), the rest are zero.
    const first = new Uint8Array(10)
    first[0] = 0x80
    expect(ulid(0, first)).toBe('0000000000G000000000000000')
    // A single 1 in the last bit of the last byte lands in the last character.
    const last = new Uint8Array(10)
    last[9] = 1
    expect(ulid(0, last)).toBe('00000000000000000000000001')
  })

  it('sorts by time: a later millisecond gives a larger id, whatever the randomness', () => {
    const early = ulid(1_700_000_000_000, new Uint8Array(10).fill(255))
    const late = ulid(1_700_000_000_001, new Uint8Array(10))
    expect(early < late).toBe(true)
  })

  it('refuses a time or a randomness it cannot encode', () => {
    expect(() => ulid(-1)).toThrow(RangeError)
    expect(() => ulid(2 ** 48)).toThrow(RangeError)
    expect(() => ulid(1.5)).toThrow(RangeError)
    expect(() => ulid(0, new Uint8Array(9))).toThrow('a ULID takes 10 random bytes, got 9')
  })
})

describe('newId and isId', () => {
  it('makes ids of the shape prefix_ULID that isId recognizes for that prefix only', () => {
    const id = newId('ent')
    expect(id).toMatch(/^ent_[0-9A-HJKMNP-TV-Z]{26}$/)
    expect(isId('ent', id)).toBe(true)
    expect(isId('rev', id)).toBe(false)
  })

  it('refuses lowercase, ambiguous letters and wrong lengths', () => {
    const zeros = (count: number) => '0'.repeat(count)
    expect(isId('ent', `ent_01ARYZ6S41${zeros(16)}`)).toBe(true)
    expect(isId('ent', `ent_01aryz6s41${zeros(16)}`)).toBe(false)
    expect(isId('ent', `ent_01ARYZ6S41${zeros(15)}I`)).toBe(false)
    expect(isId('ent', `ent_01ARYZ6S41${zeros(15)}`)).toBe(false)
    expect(isId('ent', `ent_01ARYZ6S41${zeros(17)}`)).toBe(false)
    expect(isId('ent', `ent-01ARYZ6S41${zeros(16)}`)).toBe(false)
  })
})
