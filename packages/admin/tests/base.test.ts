import { describe, expect, it } from 'vite-plus/test'
import { adminBase } from '../app/lib/base.ts'

describe('the base of the admin', () => {
  it('is /admin when the page was served there, and the root of the origin otherwise', () => {
    expect(
      ['/admin', '/admin/', '/admin/settings/site', '/', '/settings', '/administrators'].map(
        adminBase,
      ),
    ).toEqual(['/admin', '/admin', '/admin', '', '', ''])
  })
})
