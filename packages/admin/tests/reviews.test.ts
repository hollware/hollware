import { describe, expect, it } from 'vite-plus/test'

import { indexAfterReload } from '../app/lib/reviews.ts'

describe('the review chosen after the list loads again', () => {
  it('stays the one chosen while it still waits, wherever it moved', () => {
    expect(indexAfterReload('b', 1, ['c', 'a', 'b'])).toBe(2)
  })

  it('is the next one in its place once it is closed, or the last when it was last', () => {
    expect(indexAfterReload('b', 1, ['a', 'c'])).toBe(1)
    expect(indexAfterReload('c', 2, ['a', 'b'])).toBe(1)
  })

  it('is none when nothing waits, or when none was chosen', () => {
    expect(indexAfterReload('a', 0, [])).toBe(-1)
    expect(indexAfterReload(null, -1, ['a'])).toBe(-1)
  })
})
