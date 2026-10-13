import { defineCollection, defineConfig } from '@hollware/core'
import * as z from 'zod'

/**
 * The config of your Hollware: one site with a small bilingual blog. Agents read it with
 * `describe_site` before they write, so everything it says is what they follow: the shape of the
 * frontmatter, the routes of an entry per locale, and the style guide.
 *
 * `my-site` is the key of the site. Create it in your database with `hollware init --site my-site`.
 */
const blog = defineCollection({
  schema: z.object({
    title: z.string().min(1),
    description: z.string().min(1).max(160),
    date: z.iso.date(),
    tags: z.array(z.string().min(1)).min(1),
    // The entries of one post in each language share this value.
    translationGroup: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
  }),
  routes: { en: '/blog/:slug/', es: '/es/blog/:slug/' },
  translations: { groupBy: 'translationGroup' },
  tags: 'tags',
  sortBy: 'date',
  styleGuide: 'Short paragraphs, one idea per section, and an example for every claim.',
})

export default defineConfig({
  sites: {
    'my-site': {
      locales: ['en', 'es'],
      defaultLocale: 'en',
      collections: { blog },
      styleGuide: 'Plain language, with the reader in the second person.',
    },
  },
})
