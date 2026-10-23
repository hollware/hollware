import { env } from 'cloudflare:workers'
import { describe, expect, it } from 'vitest'

import type { Fetch } from '../../src/analytics/request.ts'
import { createAnalyticsSources } from '../../src/analytics/sources.ts'
import { agent } from '../ops/support.ts'
import { newWorld, type World } from '../ops/world.ts'

const MASTER = 'm'.repeat(48)
const CREDENTIAL = 'phx_the_personal_key_of_the_test_0123456789'

function posthog() {
  const calls: string[] = []
  let views = 40
  const fetch: Fetch = async (url) => {
    calls.push(url)
    if (url.endsWith('/@current/')) return Response.json({ id: 7, name: 'Blog' })
    return Response.json({
      results: [
        ['/en/blog/read-a-lot/', views],
        ['/', 3],
      ],
    })
  }
  return { fetch, calls, setViews: (next: number) => (views = next) }
}

const keyOf = (key: RequestInfo | URL): string =>
  typeof key === 'string' ? key : key instanceof URL ? key.href : key.url

function memoryCache() {
  const kept = new Map<string, string>()
  return {
    kept,
    match: async (key: RequestInfo | URL) => {
      const body = kept.get(keyOf(key))
      return body === undefined ? undefined : new Response(body)
    },
    put: async (key: RequestInfo | URL, response: Response) => {
      kept.set(keyOf(key), await response.text())
    },
  }
}

function connected(
  world: World,
  fetch: Fetch,
  options: { master?: string | undefined; cache?: ReturnType<typeof memoryCache> } = {},
) {
  const analytics = createAnalyticsSources({
    db: world.db,
    master: 'master' in options ? options.master : MASTER,
    fetch,
    cache: options.cache ?? null,
    now: () => world.time.clock.now(),
  })
  const site = { ...world.tenant.site, url: 'https://blog.example.com' }
  return agent({ ...world.context(), site, analytics })
}

describe('the analytics connection of a site', () => {
  it('asks the provider first, then keeps the credential sealed and answers it nowhere', async () => {
    const world = await newWorld(env.DB, 'ana-connect')
    const provider = posthog()
    const hollware = connected(world, provider.fetch)

    const answer = await hollware.connectAnalytics({ provider: 'posthog', credential: CREDENTIAL })
    const status = await hollware.getAnalytics()
    const row = await world.db
      .prepare('SELECT provider, settings, sealed FROM site_analytics WHERE site_id = ?1')
      .bind(world.tenant.key)
      .first<{ provider: string; settings: string; sealed: string }>()

    expect(answer).toEqual({
      outcome: 'connected',
      settings: { host: 'https://us.posthog.com', projectId: 7 },
      views: 43,
      paths: 2,
    })
    expect(status).toEqual({
      outcome: 'connected',
      provider: 'posthog',
      settings: { host: 'https://us.posthog.com', projectId: 7 },
      connectedAt: '2026-10-13T10:00:00.000Z',
      checkedAt: '2026-10-13T10:00:00.000Z',
    })
    expect(row?.sealed.startsWith('v2.')).toBe(true)
    expect(JSON.stringify([answer, status, row])).not.toContain(CREDENTIAL)
  })

  it('saves nothing when the provider turns the credential down', async () => {
    const world = await newWorld(env.DB, 'ana-refused')
    const hollware = connected(world, async () =>
      Response.json({ detail: 'invalid' }, { status: 401 }),
    )

    const answer = await hollware.connectAnalytics({ provider: 'posthog', credential: CREDENTIAL })

    expect(answer.outcome).toBe('refused')
    expect(answer.fix).toContain('Query read')
    expect(await hollware.getAnalytics()).toEqual({ outcome: 'not_connected' })
  })

  it('answers the counts through content_stats, kept ten minutes until the connection changes', async () => {
    const world = await newWorld(env.DB, 'ana-cache')
    const provider = posthog()
    const cache = memoryCache()
    const hollware = connected(world, provider.fetch, { cache })
    await hollware.connectAnalytics({ provider: 'posthog', credential: CREDENTIAL })
    const asked = provider.calls.length

    const first = await hollware.contentStats({ days: 30, limit: 5 })
    provider.setViews(90)
    const again = await hollware.contentStats({ days: 30, limit: 5 })
    world.time.set('2026-10-13T11:00:00.000Z')
    await hollware.connectAnalytics({ provider: 'posthog', credential: CREDENTIAL })
    const afterChange = await hollware.contentStats({ days: 30, limit: 5 })

    expect(first.source).toBe('posthog')
    expect(first.pages?.map((page) => [page.path, page.views])).toEqual([
      ['/en/blog/read-a-lot', 40],
      ['/', 3],
    ])
    expect(again.pages?.[0]?.views).toBe(40)
    expect(provider.calls.length - asked).toBe(1 + 2 + 1)
    expect(afterChange.pages?.[0]?.views).toBe(90)
    expect([...cache.kept.keys()].join(' ')).not.toContain(CREDENTIAL)
  })

  it('is unavailable with the way to connect, without a connection or without HOLLWARE_SECRET', async () => {
    const world = await newWorld(env.DB, 'ana-none')
    const provider = posthog()

    const none = await connected(world, provider.fetch).contentStats({})
    const unsealable = await connected(world, provider.fetch, {
      master: undefined,
    }).connectAnalytics({
      provider: 'posthog',
      credential: CREDENTIAL,
    })

    expect(none.outcome).toBe('unavailable')
    expect(none.fix).toContain('Site, Analytics')
    expect(unsealable).toEqual({ outcome: 'unavailable' })
    expect(provider.calls).toEqual([])
  })

  it('does not open a credential copied to another site', async () => {
    const world = await newWorld(env.DB, 'ana-bound')
    const other = await newWorld(env.DB, 'ana-other')
    await connected(world, posthog().fetch).connectAnalytics({
      provider: 'posthog',
      credential: CREDENTIAL,
    })
    await other.db
      .prepare(
        `INSERT INTO site_analytics (id, site_id, provider, settings, sealed, checked_at, created_at, updated_at)
         SELECT 'ana_copied', ?2, provider, settings, sealed, checked_at, created_at, updated_at
         FROM site_analytics WHERE site_id = ?1`,
      )
      .bind(world.tenant.key, other.tenant.key)
      .run()

    const answer = await connected(other, posthog().fetch).contentStats({})

    expect(answer.outcome).toBe('unavailable')
    expect(answer.fix).toContain('no longer opens')
  })

  it('forgets the connection on disconnect, once', async () => {
    const world = await newWorld(env.DB, 'ana-forget')
    const hollware = connected(world, posthog().fetch)
    await hollware.connectAnalytics({ provider: 'posthog', credential: CREDENTIAL })

    expect(await hollware.disconnectAnalytics()).toEqual({ outcome: 'disconnected' })
    expect(await hollware.disconnectAnalytics()).toEqual({ outcome: 'not_connected' })
    expect(await hollware.getAnalytics()).toEqual({ outcome: 'not_connected' })
  })

  it('asks for the GA4 property, and for the hosts of a site without url, before asking anyone', async () => {
    const world = await newWorld(env.DB, 'ana-invalid')
    const calls: string[] = []
    const fetch: Fetch = async (url) => {
      calls.push(url)
      return Response.json({})
    }
    const noUrl = agent({
      ...world.context(),
      analytics: createAnalyticsSources({
        db: world.db,
        master: MASTER,
        fetch,
        cache: null,
        now: () => world.time.clock.now(),
      }),
    })

    const ga4 = await connected(world, fetch).connectAnalytics({
      provider: 'ga4',
      credential: '{}',
    })
    const hostless = await noUrl.connectAnalytics({ provider: 'posthog', credential: CREDENTIAL })

    expect(ga4.outcome).toBe('invalid')
    expect(ga4.fix).toContain('propertyId')
    expect(hostless.outcome).toBe('invalid')
    expect(hostless.fix).toContain('settings.hosts')
    expect(calls).toEqual([])
  })
})
