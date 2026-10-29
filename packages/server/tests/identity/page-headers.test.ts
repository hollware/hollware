import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vite-plus/test'

import {
  consentPage,
  messagePage,
  pageHeaders,
  plainPageHeaders,
  signInPage,
  STYLE_HASH,
} from '../../src/identity/pages.ts'

const SOURCE = readFileSync(join(import.meta.dirname, '../../src/identity/pages.ts'), 'utf8')

describe('the headers of the sign-in, setup and consent pages', () => {
  it('allow one stylesheet, by the hash of the one the pages carry', () => {
    const style = /const STYLE = `([\s\S]*?)`\n/.exec(SOURCE)?.[1] ?? ''
    const hash = createHash('sha256').update(style).digest('base64')

    expect(STYLE_HASH).toBe(`sha256-${hash}`)
    expect(pageHeaders('n')['content-security-policy']).toContain(`style-src '${STYLE_HASH}';`)
    expect(plainPageHeaders()['content-security-policy']).toContain(`style-src '${STYLE_HASH}';`)
    expect(JSON.stringify([pageHeaders('n'), plainPageHeaders()])).not.toContain('unsafe-inline')
  })

  it('leave form-action open on the consent page, since a browser applies it to the redirect to the client', () => {
    expect(plainPageHeaders()['content-security-policy']).not.toContain('form-action')
  })

  it('show the icons of the admin, from its own origin only', () => {
    const icons = [
      '<link rel="icon" href="/admin/favicon.ico" sizes="32x32">',
      '<link rel="icon" type="image/svg+xml" href="/admin/favicon.svg">',
      '<link rel="apple-touch-icon" href="/admin/apple-touch-icon.png">',
    ]
    const consent = consentPage({
      clientName: 'Claude',
      redirectHost: 'claude.ai',
      redirectIsLoopback: false,
      person: 'Ana',
      scopes: ['content:read'],
      sites: ['blog'],
      handle: 'h',
    })

    for (const html of [
      signInPage('n', { providers: [], passkeys: true, returnTo: null }),
      messagePage('Gone', 'Sign in again.'),
      consent,
    ]) {
      for (const icon of icons) expect(html).toContain(icon)
    }
    for (const headers of [pageHeaders('n'), plainPageHeaders()]) {
      expect(headers['content-security-policy']).toContain("img-src 'self';")
    }
  })

  it('isolate the page from other origins and ask for no device', () => {
    const isolation = {
      'cross-origin-opener-policy': 'same-origin',
      'cross-origin-resource-policy': 'same-origin',
      'permissions-policy':
        'camera=(), microphone=(), geolocation=(), payment=(), usb=(), serial=()',
    }
    expect(pageHeaders('n')).toMatchObject(isolation)
    expect(plainPageHeaders()).toMatchObject(isolation)
  })
})
