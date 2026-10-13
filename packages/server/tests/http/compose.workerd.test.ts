import { ConfigError, defineCollection, defineConfig } from '@hollware/core'
import { env } from 'cloudflare:workers'
import { describe, expect, it } from 'vitest'
import * as z from 'zod'

import { createHollwareWith } from '../../src/compose.ts'
import { CANNED, fakeHandlers } from '../mcp/support.ts'
import { boot, CONFIG, fakeContext, HOST, PUBLIC_URL, SITE_KEY, wire } from './support.ts'

// Fails when: `createHollwareWith` stops resolving the config when it is called, so that a broken
// config throws its `ConfigError` (with its path, its message and its fix) at startup, and not at
// the first request, or at all; stops returning the `fetch` and the `Hollware` class of the Worker
// and nothing else; makes `fetch` depend on being called as a method of the object (a Worker
// writes `export default { fetch: hollware.fetch }`); or stops giving the Worker the system clock
// when none is passed, read at each request and not once at startup (a token's expiry is judged by
// it). The one site of the config reaches the handlers in `mcp.workerd.test.ts`.

const collection = defineCollection({
  schema: z.object({ title: z.string().min(1) }),
  routes: { en: '/blog/:slug/' },
})

describe('createHollwareWith', () => {
  it('throws the ConfigError of a config with two sites when it is called, naming what to change', () => {
    const { handlers } = fakeHandlers()
    const config = defineConfig({
      sites: {
        first: { locales: ['en'], defaultLocale: 'en', collections: { blog: collection } },
        second: { locales: ['en'], defaultLocale: 'en', collections: { blog: collection } },
      },
    })

    const startup = () => createHollwareWith(config, handlers)

    expect(startup).toThrow(ConfigError)
    expect(startup).toThrow(
      'sites: has 2 sites ("first", "second"), and v0.1 serves exactly one site per deployment. Keep exactly one site in sites.',
    )
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
      'sites: has no site, and v0.1 serves exactly one site per deployment.',
    )
    expect(() => createHollwareWith(wrongLocale, handlers)).toThrow(
      'sites.blog.defaultLocale: is "es", which is not one of the locales ("en"). Set it to one of "en", or add "es" to locales.',
    )
  })

  it('returns the fetch and the Hollware class, and nothing else', () => {
    const { worker } = boot()

    expect(Object.keys(worker).sort()).toEqual(['Hollware', 'fetch'])
    expect(typeof worker.fetch).toBe('function')
    expect(typeof worker.Hollware).toBe('function')
  })

  it('has a fetch that does not need its object: the Worker exports it detached', async () => {
    const { handlers } = fakeHandlers()
    const { fetch } = createHollwareWith(CONFIG, handlers)
    const { ctx } = fakeContext()

    const response = await fetch(
      new Request(`${PUBLIC_URL}/health`, { headers: { host: HOST } }),
      { DB: env.DB, HOLLWARE_PUBLIC_URL: PUBLIC_URL },
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
    const instance = new Hollware(ctx, { DB: env.DB, HOLLWARE_PUBLIC_URL: PUBLIC_URL })

    await instance.describeSite(SITE_KEY)
    await new Promise((resolve) => setTimeout(resolve, 50))
    await instance.describeSite(SITE_KEY)

    const [first, second] = times
    expect(times).toHaveLength(2)
    expect(Math.abs((first ?? 0) - Date.now())).toBeLessThan(60_000)
    expect(second).toBeGreaterThan(first ?? Number.POSITIVE_INFINITY)
  })
})
