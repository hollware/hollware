import { defineCollection, defineConfig } from '@hollware/core'
import * as z from 'zod'

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
