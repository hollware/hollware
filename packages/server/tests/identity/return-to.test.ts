import { describe, expect, it } from 'vite-plus/test'

import { sameOriginTarget, signInPage } from '../../src/identity/pages.ts'

// Fails when: the sign-in page (src/identity/pages.ts) sends a person, after their passkey, to a
// `return_to` on another host, however it is written (T-43 of docs/security/threat-model.md:
// `//host`, `/\host`, a tab, a scheme, a full URL), or stops sending them to a page of its own
// origin with its query and fragment; or the page stops running that very function.

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
