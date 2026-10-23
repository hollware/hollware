import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vite-plus/test'

import { signWebhook, verifyWebhook } from '../src/webhooks.ts'

const importsOf = (url: URL) =>
  [
    ...readFileSync(url, 'utf8').matchAll(/^\s*(?:import|export)[^'"]*from\s+['"]([^'"]+)['"]/gm),
  ].map((match) => match[1])

describe('the webhooks entry', () => {
  it('reaches core only through its webhooks module, which imports nothing', () => {
    expect(importsOf(new URL('../src/webhooks.ts', import.meta.url))).toEqual([
      '@hollware/core/webhooks',
    ])
    expect(importsOf(new URL('../../core/src/webhooks.ts', import.meta.url))).toEqual([])
  })

  it('signs and checks a delivery', async () => {
    const at = 1_792_300_000
    const body = '{"id":"evt_1"}'
    const headers = new Headers({
      'hollware-signature': await signWebhook('s3cret', at, body),
      'hollware-timestamp': String(at),
    })
    expect(await verifyWebhook({ secret: 's3cret', body, headers, now: at })).toBe(true)
    expect(await verifyWebhook({ secret: 'other', body, headers, now: at })).toBe(false)
  })
})
