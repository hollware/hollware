import { describe, expect, it } from 'vite-plus/test'

import { apexOf } from '../../../web/server/utils/apex.ts'

describe('apexOf', () => {
  it('moves www to the apex, path and query kept, and leaves the apex alone', () => {
    expect(apexOf(new URL('https://www.hollware.com/docs/first-steps/?ref=x'))).toBe(
      'https://hollware.com/docs/first-steps/?ref=x',
    )
    expect(apexOf(new URL('https://hollware.com/docs/'))).toBeNull()
  })
})
