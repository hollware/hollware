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
    expect(signInPage('nonce', { providers: [], passkeys: true, returnTo: null })).toContain(
      `const sameOriginTarget = ${sameOriginTarget.toString()}`,
    )
  })
})

describe('the sign-in page with providers', () => {
  it('links each provider with the escaped return_to, and offers no passkey when they are off', () => {
    const page = signInPage('nonce', {
      providers: [{ id: 'google', name: 'Google' }],
      passkeys: false,
      returnTo: '/authorize?a=1&b="x"',
    })
    expect(page).toContain(
      '<a class="provider" href="/auth/federate/google?return_to=%2Fauthorize%3Fa%3D1%26b%3D%22x%22">Continue with Google</a>',
    )
    expect(page).not.toContain('Sign in with a passkey')
    expect(page).not.toContain('/auth/signin/options')
  })
})
