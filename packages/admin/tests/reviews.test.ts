import { describe, expect, it } from 'vite-plus/test'

import { anchorOf, commentsOn, exclusionOf, indexAfterReload } from '../app/lib/reviews.ts'

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

describe('the anchor of a comment on an entry of a review', () => {
  it('is the entry alone without a first line, and one line when the last is missing or before it', () => {
    expect(anchorOf('ent_a', null, 4)).toEqual({ entryId: 'ent_a' })
    expect(anchorOf('ent_a', 3, null)).toEqual({ entryId: 'ent_a', lines: { from: 3, to: 3 } })
    expect(anchorOf('ent_a', 3, 1)).toEqual({ entryId: 'ent_a', lines: { from: 3, to: 3 } })
    expect(anchorOf('ent_a', 3, 7)).toEqual({ entryId: 'ent_a', lines: { from: 3, to: 7 } })
  })
})

describe('the comments of an entry of a review', () => {
  it('are those about it, and those about no entry belong to the whole review', () => {
    const comments = [
      { id: 'c1', entryId: null },
      { id: 'c2', entryId: 'ent_a' },
      { id: 'c3', entryId: 'ent_b' },
    ]

    expect(commentsOn(comments, 'ent_a').map((comment) => comment.id)).toEqual(['c2'])
    expect(commentsOn(comments, null).map((comment) => comment.id)).toEqual(['c1'])
  })
})

describe('the entries an approval leaves out', () => {
  it('are the excluded entries of this review, in its order', () => {
    expect(
      exclusionOf(new Set(['ent_c', 'ent_gone', 'ent_a']), ['ent_a', 'ent_b', 'ent_c']),
    ).toEqual(['ent_a', 'ent_c'])
  })
})
