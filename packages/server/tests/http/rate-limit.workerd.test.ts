import { describe, expect, it } from 'vitest'

import { limitedRoute } from '../../src/http/gateway.ts'
import { boot, wire } from './support.ts'

// Fails when: the gateway (src/http/gateway.ts) stops limiting, per address and route, the routes
// anyone may call without a token when the Worker has a rate limiting binding (T-10 of
// docs/security/threat-model.md): it stops answering 429 with Retry-After past the limit, counts
// two addresses or two routes as one, limits a route behind a token or a read, or limits anything
// when the Worker has no binding.

/** A binding that lets `allowed` requests through for each key, and records the keys. */
function limiter(allowed: number) {
  const counts = new Map<string, number>()
  return {
    keys: counts,
    binding: {
      limit: async ({ key }: { key: string }) => {
        const count = (counts.get(key) ?? 0) + 1
        counts.set(key, count)
        return { success: count <= allowed }
      },
    },
  }
}

const from = (address: string) => ({
  method: 'POST',
  body: '{}',
  headers: { 'cf-connecting-ip': address },
})

describe('the rate limit of the routes without a token', () => {
  // Seven requests, each through D1: under the load of the whole suite more than the default 5 s.
  it('answers 429 past the limit, per address and route', { timeout: 30_000 }, async () => {
    const limit = limiter(2)
    const worker = boot({ bindings: { HOLLWARE_RATE_LIMIT: limit.binding } })

    const statuses = []
    for (let i = 0; i < 3; i++) {
      statuses.push((await worker.send('/auth/signin/options', from('203.0.113.7'))).status)
    }
    const other = await worker.send('/auth/signin/options', from('203.0.113.8'))
    const oauth = await worker.send('/oauth/register', from('203.0.113.7'))
    const refused = await worker.send('/auth/signin/options', from('203.0.113.7'))

    expect(statuses.slice(0, 2).every((status) => status !== 429)).toBe(true)
    expect(statuses[2]).toBe(429)
    expect(other.status).not.toBe(429)
    expect(oauth.status).not.toBe(429)
    expect(await wire(refused)).toEqual({
      status: 429,
      headers: expect.objectContaining({ 'retry-after': '60', 'cache-control': 'no-store' }),
      body: {
        code: 'rate_limited',
        message: 'Too many requests from this address to this route.',
        fix: 'Wait a minute and try again.',
      },
    })
    expect([...limit.keys.keys()].sort()).toEqual([
      'auth:203.0.113.7',
      'auth:203.0.113.8',
      'oauth:203.0.113.7',
    ])
  })

  it(
    'limits nothing without a binding, and never a route behind a token or a read',
    { timeout: 30_000 },
    async () => {
      const worker = boot()
      const statuses = []
      for (let i = 0; i < 5; i++) {
        statuses.push((await worker.send('/auth/signin/options', from('203.0.113.9'))).status)
      }
      expect(statuses.includes(429)).toBe(false)
      expect(
        [
          ['POST', '/auth/signin/verify'],
          ['POST', '/oauth/token'],
          ['POST', '/oauth/register'],
          ['POST', '/events'],
          ['POST', '/mcp'],
          ['GET', '/auth/signin/options'],
          ['GET', '/v1/site'],
          ['POST', '/v1/ops/publish'],
        ].map(([method, path]) => limitedRoute(method ?? '', path ?? '')),
      ).toEqual(['auth', 'oauth', 'oauth', null, null, null, null, null])
    },
  )
})
