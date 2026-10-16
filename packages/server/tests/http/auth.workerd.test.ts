import { generatePersonalToken } from '@hollware/core'
import { env } from 'cloudflare:workers'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { readUse, seedToken } from '../auth/support.ts'
import { rpc } from '../mcp/support.ts'
import { boot, captureLogs, restoreLogs, OTHER_SITE_KEY, SITE_KEY, wire } from './support.ts'

// Fails when: the token check stops standing in front of the MCP endpoint: a request to `/mcp`
// with no token (any method but the preflight), or with a token that is unknown, malformed, expired
// (a second ago or at this very instant of the clock), revoked or of another site, stops being 401
// with the challenge of its case (the realm, the protected resource metadata of `/mcp` and the
// baseline scope, plus `error="invalid_token"` with a refused one) and the body of `unauthorized`; the reason a token was refused reaches the
// answer instead of only the log; a handler runs for a request that was refused; the lookup
// leaves the primary database for a replica session or is skipped for a request with no token;
// the token is looked up for any site but the one of this deployment; `last_used_at` stops being
// written through `ctx.waitUntil`, at most once an hour, from the clock of each request and not
// from the system's or the startup's. D1 is the real one, migrated.

const REQUEST_ID = '5c1f6a52-0f67-4c4e-9d3a-2f6a8e1b7c90'

/** Where a client reads how to get a token for `/mcp` (RFC 9728), which every 401 names. */
const METADATA = 'https://hollware.test/.well-known/oauth-protected-resource/mcp'

const NO_TOKEN = {
  status: 401,
  headers: {
    'cache-control': 'no-store',
    'content-type': 'application/json',
    pragma: 'no-cache',
    'www-authenticate': `Bearer realm="hollware", resource_metadata="${METADATA}", scope="content:read"`,
  },
  body: {
    code: 'unauthorized',
    message: 'The request carries no token.',
    fix: 'Send a personal token as "Authorization: Bearer <token>" (create one with `hollware token create`), or sign in through OAuth: the challenge names where.',
  },
}

const REFUSED = {
  status: 401,
  headers: {
    'cache-control': 'no-store',
    'content-type': 'application/json',
    pragma: 'no-cache',
    'www-authenticate': `Bearer realm="hollware", resource_metadata="${METADATA}", error="invalid_token", scope="content:read"`,
  },
  body: {
    code: 'unauthorized',
    message: 'The token was not accepted.',
    fix: 'Tokens expire and can be revoked. Create a new personal token with `hollware token create`, or sign in through OAuth again, and send it as "Authorization: Bearer <token>".',
  },
}

/** After the time the tests start at, which is 2026-10-13T12:00:00.000Z. */
const LATER = '2026-11-11T12:00:00.000Z'

afterEach(() => {
  vi.restoreAllMocks()
  restoreLogs()
})

describe('a request to /mcp with no token', () => {
  it.each(['GET', 'POST', 'PUT', 'PATCH', 'DELETE'])(
    'is refused with 401 and the challenge, for %s',
    async (method) => {
      const worker = boot()

      const response = await worker.send('/mcp', {
        method,
        body: method === 'POST' ? '{}' : undefined,
      })

      expect(await wire(response)).toEqual(NO_TOKEN)
      expect(worker.seen).toEqual([])
      expect(worker.queries).toEqual([])
      expect(worker.waited).toEqual([])
    },
  )

  it('is refused for HEAD as well, with the challenge', async () => {
    const worker = boot()

    const response = await worker.send('/mcp', { method: 'HEAD' })

    expect(response.status).toBe(401)
    expect(response.headers.get('www-authenticate')).toBe(NO_TOKEN.headers['www-authenticate'])
  })

  it('answers a preflight (OPTIONS) with 204 and nothing else: it carries no token to check', async () => {
    const worker = boot()

    const response = await worker.send('/mcp', { method: 'OPTIONS' })

    expect(response.status).toBe(204)
    expect(worker.seen).toEqual([])
    expect(worker.queries).toEqual([])
  })

  it('is logged, with the id of the request and no more', async () => {
    const logs = captureLogs()
    const worker = boot()
    vi.spyOn(crypto, 'randomUUID').mockReturnValueOnce(REQUEST_ID)

    await worker.send('/mcp', { method: 'POST', body: '{}' })

    expect(logs.entries()).toEqual([
      { kind: 'auth_refused', requestId: REQUEST_ID, reason: 'no_token' },
    ])
  })
})

describe('a request to /mcp with a token that is refused', () => {
  /** Each way a token fails, as a token the test makes, and the reason the log must give. */
  const CASES = [
    ['unknown', 'unknown', async () => generatePersonalToken()],
    ['malformed', 'unknown', async () => 'not-a-personal-token'],
    [
      'expired a second ago',
      'expired',
      async () =>
        (await seedToken(env.DB, SITE_KEY, { expiresAt: '2026-10-13T11:59:59.000Z' })).token,
    ],
    [
      'expiring at this very instant',
      'expired',
      async () =>
        (await seedToken(env.DB, SITE_KEY, { expiresAt: '2026-10-13T12:00:00.000Z' })).token,
    ],
    [
      'revoked',
      'revoked',
      async () =>
        (
          await seedToken(env.DB, SITE_KEY, {
            expiresAt: LATER,
            revokedAt: '2026-10-13T11:00:00.000Z',
          })
        ).token,
    ],
    [
      'of another site',
      'unknown',
      async () => (await seedToken(env.DB, OTHER_SITE_KEY, { expiresAt: LATER })).token,
    ],
  ] as const

  it.each(CASES)(
    'is refused with 401 when it is %s, and says nothing of why',
    async (_name, reason, makeToken) => {
      const logs = captureLogs()
      const token = await makeToken()
      const worker = boot()
      vi.spyOn(crypto, 'randomUUID').mockReturnValueOnce(REQUEST_ID)

      const response = await worker.send('/mcp', { method: 'POST', body: '{}', token })

      expect(await wire(response)).toEqual(REFUSED)
      expect(logs.entries()).toEqual([{ kind: 'auth_refused', requestId: REQUEST_ID, reason }])
      expect(worker.seen).toEqual([])
      expect(worker.waited).toEqual([])
      expect(worker.sessions).toEqual([])
      expect(worker.queries.every((query) => query.via === 'primary')).toBe(true)
    },
  )

  it('looks the token up on the primary database, in the tokens of this site', async () => {
    const seeded = await seedToken(env.DB, SITE_KEY, { revokedAt: '2026-10-13T11:00:00.000Z' })
    const worker = boot()

    await worker.send('/mcp', { method: 'POST', body: '{}', token: seeded.token })

    // The registry reads the versions of the sites first (ADR-033); then the one lookup.
    const lookups = worker.queries.filter((query) => !query.sql.includes('FROM sites'))
    expect(worker.sessions).toEqual([])
    expect(lookups).toHaveLength(1)
    expect(lookups[0]?.via).toBe('primary')
    expect(lookups[0]?.sql).toContain('FROM tokens')
  })

  it('does not write the last use of a token that was refused', async () => {
    const seeded = await seedToken(env.DB, SITE_KEY, { revokedAt: '2026-10-13T11:00:00.000Z' })
    const worker = boot()

    await worker.send('/mcp', { method: 'POST', body: '{}', token: seeded.token })
    await worker.settle()

    expect((await readUse(env.DB, seeded.tokenId))?.last_used_at).toBeNull()
  })
})

describe('the last use of a token', () => {
  /** The cheapest request a token can make that the endpoint serves. */
  const list = (worker: ReturnType<typeof boot>, token: string) =>
    rpc(worker.endpoint(token), 'modern', 'tools/list')

  it('is written once an hour through ctx.waitUntil, from the clock of the request', async () => {
    const seeded = await seedToken(env.DB, SITE_KEY, { expiresAt: LATER })
    const worker = boot()

    const first = await list(worker, seeded.token)
    expect(first.status).toBe(200)
    expect(worker.waited).toHaveLength(1)
    await worker.settle()
    expect(await readUse(env.DB, seeded.tokenId)).toEqual({
      last_used_at: '2026-10-13T12:00:00.000Z',
      updated_at: '2026-10-13T12:00:00.000Z',
    })

    worker.clock.set('2026-10-13T12:30:00.000Z')
    await list(worker, seeded.token)
    expect(worker.waited).toHaveLength(1)

    worker.clock.set('2026-10-13T13:01:00.000Z')
    await list(worker, seeded.token)
    expect(worker.waited).toHaveLength(2)
    await worker.settle()
    expect((await readUse(env.DB, seeded.tokenId))?.last_used_at).toBe('2026-10-13T13:01:00.000Z')
  })
})
