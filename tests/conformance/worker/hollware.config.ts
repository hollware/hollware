import { defineCollection, defineConfig } from '../../../packages/core/src/index.ts'
import * as z from '../../../packages/core/node_modules/zod/index.js'

/**
 * The config of the Worker under test: one site with one collection. The conformance suite never
 * reads content, so this only has to be a valid config, as small as one can be.
 *
 * Both imports are relative because this folder is not a package with its own `node_modules`:
 * `@hollware/core` resolves to its source (ADR-016), and zod is the copy that core installs.
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
