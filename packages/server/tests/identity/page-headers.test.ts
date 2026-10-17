import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vite-plus/test'

import { pageHeaders, plainPageHeaders, STYLE_HASH } from '../../src/identity/pages.ts'

// Fails when: the pages of the Worker (src/identity/pages.ts) allow inline styles other than their
// own stylesheet, whose hash STYLE_HASH must be, or stop saying that no other origin may hold,
// embed or ask a device of them.

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
