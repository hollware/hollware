import { describe, expect, it } from 'vite-plus/test'

import { secondsCacheRules } from '../src/route-rules.ts'
import { markPreviewRequest } from '../src/runtime/tags.ts'

const TOKEN = 'hw_prv_eyJzIjoicyJ9.c2ln-_9'

type Headers = Record<string, string | string[] | undefined>

describe('a request that carries a preview token', () => {
  it('gets a fresh header of its own for Nitro to vary on, and a request without one gets none', () => {
    const first: Headers = { cookie: `hollware_preview=${TOKEN}` }
    const second: Headers = { cookie: `hollware_preview=${TOKEN}` }
    const forged: Headers = { 'x-hollware-preview': 'shared', cookie: 'hollware_preview=nope' }

    for (const headers of [first, second, forged]) markPreviewRequest(headers)

    expect(first['x-hollware-preview']).toMatch(/^[0-9a-f-]{36}$/)
    expect(second['x-hollware-preview']).not.toBe(first['x-hollware-preview'])
    expect(forged).toEqual({ cookie: 'hollware_preview=nope' })
  })
})

describe('the cache of `hollware.cache: <seconds>`', () => {
  it('keeps pages for that long, varied on the preview header, and never the module routes', () => {
    expect(secondsCacheRules(60)).toEqual({
      '/**': { cache: { swr: true, maxAge: 60, varies: ['x-hollware-preview'] } },
      '/_hollware/**': { swr: false, cache: false },
    })
  })
})
