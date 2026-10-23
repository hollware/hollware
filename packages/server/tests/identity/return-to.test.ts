import { describe, expect, it } from 'vite-plus/test'

import { sameOriginTarget, signInPage } from '../../src/identity/pages.ts'

const ORIGIN = 'https://cms.example.com'

describe('sameOriginTarget', () => {
  it('keeps a page of the origin, with its query and fragment', () => {
    expect(sameOriginTarget('/authorize?client_id=x&state=y#top', ORIGIN)).toBe(
      '/authorize?client_id=x&state=y#top',
    )
    expect(sameOriginTarget(null, ORIGIN)).toBe('/admin/')
  })

  it.each([
    '//evil.example/',
    '/\\evil.example',
    '/\t/evil.example',
    '\\\\evil.example',
    'https://evil.example/',
    'javascript:alert(1)',
    'HTTPS://evil.example',
    'https://cms.example.com.evil.example/',
  ])('sends %j to the admin, not to another host', (target) => {
    expect(sameOriginTarget(target, ORIGIN)).toBe('/admin/')
  })

  it('is the function the page runs', () => {
    expect(signInPage('nonce')).toContain(`const sameOriginTarget = ${sameOriginTarget.toString()}`)
  })
})
