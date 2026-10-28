import { describe, expect, it } from 'vite-plus/test'

import { databaseSize } from '../app/lib/database.ts'

describe('the size of the database', () => {
  it('reads in megabytes with one decimal, and is near the cap of the Free plan from 400 MB', () => {
    expect([
      databaseSize(12_345_678),
      databaseSize(399_999_999),
      databaseSize(400_000_000),
    ]).toEqual([
      { megabytes: 12.3, near: false },
      { megabytes: 400, near: false },
      { megabytes: 400, near: true },
    ])
  })
})
