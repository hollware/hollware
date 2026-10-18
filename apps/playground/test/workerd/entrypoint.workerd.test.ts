import type { HollwareRpc } from '@hollware/server'
import { exports } from 'cloudflare:workers'
import { expect, it } from 'vitest'

// Fails when: src/index.ts stops exporting the class `Hollware` of createHollware(config), which
// sites reach over a service binding, or builds it from another config than
// hollware.config.ts: describeSite must answer the playground's site, with its two locales and the
// routes of its blog. The six methods and their errors are the server package's tests, and the
// binding itself is the harness's (test/harness).

// Cloudflare's `Service<...>` types every answer that holds `unknown` as `never`, so the stub is
// read through the interface it implements, as a site does (examples/worker-site/src/env.ts).
const rpc: HollwareRpc = exports.Hollware

it('serves the site of hollware.config.ts over RPC', async () => {
  const answer = await rpc.describeSite('playground')

  expect(answer).toMatchObject({
    outcome: 'ok',
    site: {
      key: 'playground',
      locales: ['es', 'en'],
      defaultLocale: 'es',
      collections: [
        {
          name: 'blog',
          routes: { es: '/blog/:slug/', en: '/en/blog/:slug/' },
          translationGroupField: 'translationGroup',
          tagsField: 'tags',
          sortByField: 'date',
        },
        {
          name: 'reports',
          routes: { es: '/informes/:slug/', en: '/en/reports/:slug/' },
          translationGroupField: null,
          tagsField: null,
          sortByField: null,
        },
      ],
    },
  })
})
