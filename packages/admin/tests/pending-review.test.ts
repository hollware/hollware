import { describe, expect, it } from 'vite-plus/test'
import { holdsSave, reviewLink } from '../app/lib/pending-review.ts'

const ASKED = {
  id: 'rvw_01JAB3XQ8ZK4M6N2P5R7S9T0VX',
  requestedByName: 'Ana',
  requestedAt: '2026-10-27T14:27:00.000Z',
}

describe('an entry that waits for review', () => {
  it('holds a save until the person says that it may cancel the request', () => {
    expect(holdsSave(ASKED, false)).toBe(true)
    expect(holdsSave(ASKED, true)).toBe(false)
    expect(holdsSave(null, false)).toBe(false)
  })

  it('links to its review in Reviews', () => {
    expect(reviewLink(ASKED)).toEqual({
      path: '/reviews',
      query: { review: 'rvw_01JAB3XQ8ZK4M6N2P5R7S9T0VX' },
    })
  })
})
