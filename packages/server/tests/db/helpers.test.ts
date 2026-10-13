import { describe, expect, it } from 'vite-plus/test'

import { chunk, rowsPerStatement } from '../../src/db/chunks.ts'
import { MAX_ROW_BYTES } from '../../src/limits.ts'
import { rowBytes, tooLarge, utf8Bytes } from '../../src/db/size.ts'

// Fails when: src/db/chunks.ts stops fitting the rows of a statement under 90 bound values
// (the room for the statement's own values and the values per row), loses or reorders an item
// when it cuts a list into chunks, or src/db/size.ts stops counting a column of a row, counts
// characters instead of UTF-8 bytes, counts an integer as anything but 8 bytes, or moves the
// limit: a row of exactly MAX_ROW_BYTES fits and one byte more does not.

describe('rowsPerStatement', () => {
  it('fits the rows of a lookup and of a tag insert under 90 bound values', () => {
    // A lookup binds the site once and three values per ref: 1 + 29 * 3 = 88, and 30 would be 91.
    expect(rowsPerStatement(1, 3)).toBe(29)
    // A tag insert binds six values of its own and two per tag: 6 + 42 * 2 = 90.
    expect(rowsPerStatement(6, 2)).toBe(42)
  })

  it('is at least one row, even when the statement alone is over the limit', () => {
    expect(rowsPerStatement(95, 3)).toBe(1)
  })
})

describe('chunk', () => {
  it('cuts a list into chunks of at most the size, in order, with nothing lost', () => {
    expect(chunk([1, 2, 3, 4, 5, 6, 7], 3)).toEqual([[1, 2, 3], [4, 5, 6], [7]])
    expect(chunk([1, 2, 3, 4], 2)).toEqual([
      [1, 2],
      [3, 4],
    ])
  })

  it('has no chunk for an empty list', () => {
    expect(chunk([], 5)).toEqual([])
  })
})

describe('utf8Bytes', () => {
  it('counts bytes, not characters', () => {
    expect(utf8Bytes('abc')).toBe(3)
    expect(utf8Bytes('é')).toBe(2)
    expect(utf8Bytes('€')).toBe(3)
    expect(utf8Bytes('🚀')).toBe(4)
    expect(utf8Bytes('')).toBe(0)
  })
})

describe('rowBytes', () => {
  it('adds every column: text in UTF-8, an integer as 8 bytes, a null as none', () => {
    expect(rowBytes({ id: 'ent_1', markdown: 'é€🚀', words: 3, parent: null, label: '' })).toBe(
      5 + (2 + 3 + 4) + 8,
    )
  })
})

describe('tooLarge', () => {
  it('lets a row of exactly the limit through, and refuses one byte more with what it counted', () => {
    expect(tooLarge({ markdown: 'a'.repeat(MAX_ROW_BYTES) })).toBeNull()
    expect(tooLarge({ markdown: 'a'.repeat(MAX_ROW_BYTES), note: 'b' })).toEqual({
      outcome: 'too_large',
      bytes: 1_900_001,
      limit: 1_900_000,
    })
  })

  it('counts the bytes of the characters, so half the limit in two-byte characters is the limit', () => {
    expect(tooLarge({ markdown: 'é'.repeat(MAX_ROW_BYTES / 2) })).toBeNull()
    expect(tooLarge({ markdown: 'é'.repeat(MAX_ROW_BYTES / 2 + 1) })).toEqual({
      outcome: 'too_large',
      bytes: 1_900_002,
      limit: 1_900_000,
    })
  })
})
