import { describe, expect, it } from 'vite-plus/test'

import { apexOf } from '../../../web/server/utils/apex.ts'

// Fails when: hollware.com (apps/web/server/utils/apex.ts) stops sending www to the apex with the
// path and the query kept, or sends the apex anywhere. The redirect itself is the middleware
// `0.www.ts`; the harness cannot send a request for www, as it sets the Host of its own.

describe('apexOf', () => {
  it('moves www to the apex, path and query kept, and leaves the apex alone', () => {
    expect(apexOf(new URL('https://www.hollware.com/docs/first-steps/?ref=x'))).toBe(
      'https://hollware.com/docs/first-steps/?ref=x',
    )
    expect(apexOf(new URL('https://hollware.com/docs/'))).toBeNull()
  })
})
