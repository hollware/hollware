import { describe, expect, it } from 'vite-plus/test'

import { isId, newId, ulid } from '../src/ids.ts'

describe('ulid', () => {
  it('encodes the time of the ULID specification examples in its first 10 characters', () => {
    expect(ulid(1469918176385, new Uint8Array(10)).slice(0, 10)).toBe('01ARYZ6S41')
    expect(ulid(1469922850259, new Uint8Array(10)).slice(0, 10)).toBe('01ARZ3NDEK')
  })

  it('encodes the random bytes, most significant bit first, in its last 16 characters', () => {
    expect(ulid(0, new Uint8Array(10))).toBe('00000000000000000000000000')
    expect(ulid(0, new Uint8Array(10).fill(255))).toBe('0000000000ZZZZZZZZZZZZZZZZ')
    const first = new Uint8Array(10)
    first[0] = 0x80
    expect(ulid(0, first)).toBe('0000000000G000000000000000')
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
