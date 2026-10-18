import { describe, expect, it } from 'vite-plus/test'

import { pageRange } from '../app/lib/table.ts'

// Fails when: the count under a table (src/components/DataTable.vue, lib/table.ts) stops naming the
// first and the last row of the page, counted from 1, of the rows the filter leaves; or names a
// row past the last one, or a page the filter emptied.

describe('the range of a page', () => {
  it('names the first and the last row of each page', () => {
    expect([pageRange(0, 25, 120), pageRange(1, 25, 120), pageRange(4, 25, 120)]).toEqual([
      { from: 1, to: 25 },
      { from: 26, to: 50 },
      { from: 101, to: 120 },
    ])
  })

  it('is 0 to 0 with no row, and the last page when a filter left fewer rows', () => {
    expect([pageRange(0, 25, 0), pageRange(3, 25, 30)]).toEqual([
      { from: 0, to: 0 },
      { from: 26, to: 30 },
    ])
  })
})
