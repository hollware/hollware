import { defineCollection, defineConfig } from '@hollware/core'
import * as z from 'zod'

/**
 * The config of the Worker under test: one site with one collection. The conformance suite never
 * reads content, so this only has to be a valid config, as small as one can be.
 */
export default defineConfig({
  sites: {
    conformance: {
      locales: ['en'],
      defaultLocale: 'en',
      collections: {
        notes: defineCollection({
          schema: z.object({ title: z.string().min(1) }),
          routes: { en: '/notes/:slug/' },
        }),
      },
    },
  },
})
