import { describe, expect, it } from 'vite-plus/test'

import { clip, compareText, count, pointer, quote } from '../../src/contracts/text.ts'

// Fails when: `clip` stops cutting at 80 characters, stops adding the ellipsis or cuts a surrogate
// pair in two; `quote` stops escaping control characters or stops clipping; `pointer` stops
// escaping `~` as `~0` and `/` as `~1` (in that order); `compareText` stops ordering by UTF-16
// code units; or `count` gets the singular wrong.

describe('clip', () => {
  it('leaves a text of at most 80 characters alone', () => {
    expect(clip('a'.repeat(80))).toBe('a'.repeat(80))
    expect(clip('')).toBe('')
  })

  it('cuts a longer text to 80 characters and adds an ellipsis', () => {
    expect(clip('a'.repeat(81))).toBe(`${'a'.repeat(80)}…`)
  })

  it('takes the limit as an argument', () => {
    expect(clip('abcdef', 3)).toBe('abc…')
    expect(clip('abc', 3)).toBe('abc')
  })

  it('never cuts a surrogate pair in two', () => {
    // 😀 is two UTF-16 units; the cut at 80 would fall between them.
    expect(clip(`${'a'.repeat(79)}😀tail`)).toBe(`${'a'.repeat(79)}…`)
    // The same emoji just inside the limit stays whole.
    expect(clip(`${'a'.repeat(78)}😀tail`)).toBe(`${'a'.repeat(78)}😀…`)
  })
})

describe('quote', () => {
  it('puts the text in JSON quotes, so that control characters show escaped', () => {
    expect(quote('javascript:alert(1)')).toBe('"javascript:alert(1)"')
    expect(quote('a\nb"c')).toBe('"a\\nb\\"c"')
  })

  it('clips before it quotes', () => {
    expect(quote('b'.repeat(200))).toBe(`"${'b'.repeat(80)}…"`)
  })
})

describe('pointer', () => {
  it('writes a JSON Pointer from its segments, and the root from none', () => {
    expect(pointer([])).toBe('')
    expect(pointer(['tags', '0'])).toBe('/tags/0')
    expect(pointer(['title'])).toBe('/title')
  })

  it('escapes ~ as ~0 and / as ~1', () => {
    expect(pointer(['a/b'])).toBe('/a~1b')
    expect(pointer(['c~d'])).toBe('/c~0d')
    // The order matters: replacing `/` first would turn a literal "/" into `~01`.
    expect(pointer(['/'])).toBe('/~1')
    expect(pointer(['/~'])).toBe('/~1~0')
    expect(pointer(['~1'])).toBe('/~01')
  })
})

describe('compareText', () => {
  it('orders by UTF-16 code units, whatever the locale', () => {
    expect(['b', 'a', 'B', 'ä'].toSorted(compareText)).toEqual(['B', 'a', 'b', 'ä'])
    expect(compareText('a', 'a')).toBe(0)
    expect(compareText('a', 'b')).toBe(-1)
    expect(compareText('b', 'a')).toBe(1)
  })
})

describe('count', () => {
  it('writes the singular for one and the plural for any other number', () => {
    expect(count(1, 'character')).toBe('1 character')
    expect(count(0, 'item')).toBe('0 items')
    expect(count(160, 'character')).toBe('160 characters')
  })
})
