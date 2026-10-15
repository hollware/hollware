import { defineCollection, defineConfig } from '@hollware/core'
import { env } from 'cloudflare:workers'
import { describe, expect, it } from 'vitest'
import * as z from 'zod'

import { createHollwareWith } from '../../src/compose.ts'
import { callRaw, CANNED, fakeHandlers } from '../mcp/support.ts'
import { seedToken } from '../auth/support.ts'
import {
  boot,
  CONFIG,
  fakeContext,
  HOST,
  OTHER_SITE_KEY,
  PUBLIC_URL,
  SITE_KEY,
  wire,
} from './support.ts'

// Fails when: `createHollwareWith` stops resolving the config when it is called, so that a broken
// config throws its `ConfigError` (with its path, its message and its fix) at startup, and not at
// the first request, or at all; stops returning the `fetch` and the `Hollware` class of the Worker
// and nothing else; makes `fetch` depend on being called as a method of the object (a Worker
// writes `export default { fetch: hollware.fetch }`); or stops giving the Worker the system clock
// when none is passed, read at each request and not once at startup (a token's expiry is judged by
// it); or stops serving every site of the config, each to the tokens of that site.

const collection = defineCollection({
  schema: z.object({ title: z.string().min(1) }),
  routes: { en: '/blog/:slug/' },
})

describe('createHollwareWith', () => {
  it('serves every site of a config with two sites: a token acts on its own site, and only on it', async () => {
    const twoSites = defineConfig({
      sites: {
        ...CONFIG.sites,
        [OTHER_SITE_KEY]: {
          locales: ['en'],
          defaultLocale: 'en',
          collections: { blog: collection },
        },
      },
    })
    const worker = boot({ config: twoSites })
    const first = await seedToken(env.DB, SITE_KEY)
    const second = await seedToken(env.DB, OTHER_SITE_KEY)

    const call = (token: string) =>
      worker.send('/v1/ops/describe_site', {
        method: 'POST',
        token,
        headers: { 'content-type': 'application/json' },
        body: '{}',
      })
    const answers = [(await call(first.token)).status, (await call(second.token)).status]
    const read = await worker.send('/v1/site', { token: second.token })
    await callRaw(worker.endpoint(second.token), 'modern', 'describe_site', {})

    expect([...answers, read.status]).toEqual([200, 200, 200])
    expect(worker.seen.map((seen) => seen.context.site.key)).toEqual([
      SITE_KEY,
      OTHER_SITE_KEY,
      OTHER_SITE_KEY,
      OTHER_SITE_KEY,
    ])
  })

  it('throws the ConfigError of a config with no site, and of a site whose default locale is not one of its own', () => {
    const { handlers } = fakeHandlers()
    const none = defineConfig({ sites: {} })
    const wrongLocale = defineConfig({
      sites: {
        blog: { locales: ['en'], defaultLocale: 'es', collections: { posts: collection } },
      },
    })

    expect(() => createHollwareWith(none, handlers)).toThrow(
      'sites: has no site, and a deployment serves at least one.',
    )
    expect(() => createHollwareWith(wrongLocale, handlers)).toThrow(
      'sites.blog.defaultLocale: is "es", which is not one of the locales ("en"). Set it to one of "en", or add "es" to locales.',
    )
  })

  it('returns the fetch, the scheduled and queue handlers and the Hollware class, and nothing else', () => {
    const { worker } = boot()

    expect(Object.keys(worker).sort()).toEqual(['Hollware', 'fetch', 'queue', 'scheduled'])
    expect(typeof worker.fetch).toBe('function')
    expect(typeof worker.Hollware).toBe('function')
  })

  it('has a fetch that does not need its object: the Worker exports it detached', async () => {
    const { handlers } = fakeHandlers()
    const { fetch } = createHollwareWith(CONFIG, handlers)
    const { ctx } = fakeContext()

    const response = await fetch(
      new Request(`${PUBLIC_URL}/health`, { headers: { host: HOST } }),
      { DB: env.DB, OAUTH_KV: env.OAUTH_KV, HOLLWARE_PUBLIC_URL: PUBLIC_URL },
      ctx,
    )

    expect(await wire(response)).toMatchObject({ status: 200, body: { ok: true } })
  })

  it('gives the handlers the system clock when none is passed, and reads it at each call', async () => {
    const times: number[] = []
    const { handlers } = fakeHandlers({
      describe_site: async (_input, context) => {
        times.push(context.clock.now().getTime())
        return CANNED.describe_site.ok
      },
    })
    const { Hollware } = createHollwareWith(CONFIG, handlers)
    const { ctx } = fakeContext()
    const instance = new Hollware(ctx, {
      DB: env.DB,
      OAUTH_KV: env.OAUTH_KV,
      HOLLWARE_PUBLIC_URL: PUBLIC_URL,
    })

    await instance.describeSite(SITE_KEY)
    await new Promise((resolve) => setTimeout(resolve, 50))
    await instance.describeSite(SITE_KEY)

    const [first, second] = times
    expect(times).toHaveLength(2)
    expect(Math.abs((first ?? 0) - Date.now())).toBeLessThan(60_000)
    expect(second).toBeGreaterThan(first ?? Number.POSITIVE_INFINITY)
  })
})
