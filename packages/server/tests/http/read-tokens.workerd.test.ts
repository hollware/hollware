import { defineConfig } from '@hollware/core'
import { env } from 'cloudflare:workers'
import { describe, expect, it } from 'vitest'

import { seedToken } from '../auth/support.ts'
import { CONFIG, OTHER_SITE_KEY, SITE_KEY, boot } from './support.ts'

const PAGE = 'https://site.example'

const TWO_SITES = defineConfig({
  ...CONFIG,
  sites: Object.fromEntries(
    Object.values(CONFIG.sites ?? {}).flatMap((site) => [
      [SITE_KEY, { ...site, cors: { origins: [PAGE] } }],
      [OTHER_SITE_KEY, site],
    ]),
  ),
})

const json = { 'content-type': 'application/json' }

describe('a read token', () => {
  it('reads over the read API, and is refused by MCP, the operations and the admin', async () => {
    const worker = boot()
    const { token } = await seedToken(env.DB, SITE_KEY, { read: true })

    const read = await worker.send('/v1/site', { token })
    const mcp = await worker.send('/mcp', { method: 'POST', token, headers: json, body: '{}' })
    const ops = await worker.send('/v1/ops/describe_site', {
      method: 'POST',
      token,
      headers: json,
      body: '{}',
    })
    const admin = await worker.send('/v1/admin/me', { token })

    expect(read.status).toBe(200)
    expect([mcp.status, ops.status]).toEqual([403, 403])
    expect(await mcp.json()).toEqual({
      code: 'forbidden',
      message: 'A read token reads published content over GET /v1, and nothing else.',
      fix: 'Use a personal token (hw_pat_) or sign in with OAuth for this.',
    })
    expect(admin.status).toBe(403)
    expect(worker.seen.map((seen) => seen.tool)).toEqual(['describe_site'])
  })
})

describe('the read API from a page', () => {
  it('answers a preflight and a read from an origin the site lists, with the ETag readable', async () => {
    const worker = boot({ config: TWO_SITES })
    const { token } = await seedToken(env.DB, SITE_KEY, { read: true })

    const preflight = await worker.send('/v1/site', {
      method: 'OPTIONS',
      headers: { origin: PAGE, 'access-control-request-method': 'GET' },
    })
    const read = await worker.send('/v1/site', { token, headers: { origin: PAGE } })

    expect(preflight.status).toBe(204)
    expect(Object.fromEntries(preflight.headers)).toMatchObject({
      'access-control-allow-origin': PAGE,
      'access-control-allow-methods': 'GET, HEAD',
      'access-control-allow-headers': 'authorization, if-none-match',
    })
    expect(read.status).toBe(200)
    expect(Object.fromEntries(read.headers)).toMatchObject({
      'access-control-allow-origin': PAGE,
      'access-control-expose-headers': 'etag, WWW-Authenticate, Retry-After',
      vary: 'Origin',
    })
  })

  it('refuses an origin no site lists, and one the site of the token does not list', async () => {
    const worker = boot({ config: TWO_SITES })
    const mine = await seedToken(env.DB, SITE_KEY, { read: true })
    const other = await seedToken(env.DB, OTHER_SITE_KEY, { read: true })

    const stranger = await worker.send('/v1/site', {
      token: mine.token,
      headers: { origin: 'https://evil.example' },
    })
    const elsewhere = await worker.send('/v1/site', {
      token: other.token,
      headers: { origin: PAGE },
    })

    expect(stranger.status).toBe(403)
    expect(await stranger.json()).toMatchObject({ code: 'forbidden_origin' })
    expect(elsewhere.status).toBe(403)
    expect(await elsewhere.json()).toMatchObject({
      code: 'forbidden_origin',
      message: `The site "${OTHER_SITE_KEY}" does not let pages of ${PAGE} read it.`,
    })
    expect(elsewhere.headers.get('access-control-allow-origin')).toBe('https://hollware.test')
    expect(worker.seen).toEqual([])
  })

  it('lets a listed origin reach nothing but the read API', async () => {
    const worker = boot({ config: TWO_SITES })
    const { token } = await seedToken(env.DB, SITE_KEY)

    const ops = await worker.send('/v1/ops/describe_site', {
      method: 'POST',
      token,
      headers: { ...json, origin: PAGE },
      body: '{}',
    })
    const mcp = await worker.send('/mcp', {
      method: 'POST',
      token,
      headers: { ...json, origin: PAGE },
      body: '{}',
    })

    const admin = await worker.send('/v1/admin/me', { token, headers: { origin: PAGE } })

    expect([ops.status, mcp.status, admin.status]).toEqual([403, 403, 403])
    expect(await admin.json()).toMatchObject({ code: 'forbidden_origin' })
    expect(await ops.json()).toMatchObject({ code: 'forbidden_origin' })
    expect(worker.seen).toEqual([])
  })
})
