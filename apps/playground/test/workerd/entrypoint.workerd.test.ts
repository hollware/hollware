import type { HollwareRpc } from '@hollware/server'
import { exports } from 'cloudflare:workers'
import { expect, it } from 'vitest'

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
