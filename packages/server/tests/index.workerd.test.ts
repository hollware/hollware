import { defineCollection, defineConfig } from '@hollware/core'
import { expect, it } from 'vitest'
import * as z from 'zod'

import { createHollware, name } from '../src/index.ts'

// Fails when: the package entry stops exporting its name, or createHollware stops building, from a
// config, a Worker whose `fetch` serves requests and whose `Hollware` entrypoint has the six read
// methods of HollwareRpc and nothing more. It runs in workerd: the entry imports `cloudflare:workers`.

const config = defineConfig({
  sites: {
    acme: {
      locales: ['en'],
      defaultLocale: 'en',
      collections: {
        notes: defineCollection({
          schema: z.object({ title: z.string() }),
          routes: { en: '/notes/:slug/' },
        }),
      },
    },
  },
})

it('exports the package name', () => {
  expect(name).toBe('@hollware/server')
})

it('builds a Worker from a config, with the read methods of the entrypoint', () => {
  const worker = createHollware(config)
  expect(typeof worker.fetch).toBe('function')
  expect(Object.getOwnPropertyNames(worker.Hollware.prototype).sort()).toEqual([
    'constructor',
    'describeSite',
    'getEntry',
    'getTranslations',
    'listEntries',
    'listRedirects',
    'search',
  ])
})
