import { defineCollection, defineConfig } from '@hollware/core'
import { expect, it } from 'vitest'
import * as z from 'zod'

import { createHollware, name } from '../src/index.ts'

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
    'getNavigation',
    'getTranslations',
    'listEntries',
    'listRedirects',
    'search',
  ])
})
