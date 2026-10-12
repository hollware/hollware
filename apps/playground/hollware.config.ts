import { defineCollection, defineComponent, defineConfig } from '@hollware/core'
import * as z from 'zod'

/**
 * The playground's config: one site with a bilingual blog, the site the tests of v0.1 write to
 * and read from. Its corpus is tests/fixtures/content/blog, and its broken variants are
 * tests/fixtures/content/invalid. The built-in contracts join `contracts` when they exist.
 */

const blog = defineCollection({
  schema: z.object({
    title: z.string().min(1),
    seoTitle: z.string().min(1).max(60).optional(),
    description: z.string().min(1).max(160),
    date: z.iso.date(),
    tags: z.array(z.string().min(1)).min(1),
    translationGroup: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
  }),
  routes: { es: '/blog/:slug/', en: '/en/blog/:slug/' },
  translations: { groupBy: 'translationGroup' },
  tags: 'tags',
  sortBy: 'date',
  components: {
    callout: defineComponent({
      props: z.strictObject({ type: z.enum(['info', 'warning', 'tip']) }),
      description: 'A highlighted note in the flow of the text.',
      example: '::callout{type="tip"}\nKeep the slug short.\n::',
    }),
    youtube: defineComponent({
      props: z.strictObject({ id: z.string().regex(/^[\w-]{11}$/) }),
      description: 'A YouTube video, by its id.',
      example: '::youtube{id="dQw4w9WgXcQ"}\n::',
    }),
  },
  contracts: [
    {
      id: 'seo-title-length',
      severity: 'warning',
      description: 'A title of at most 60 characters, or a seoTitle, which search engines show.',
      check: ({ frontmatter }) =>
        frontmatter.title.length <= 60 || frontmatter.seoTitle !== undefined
          ? []
          : [
              {
                path: '/frontmatter/title',
                message: `The title has ${frontmatter.title.length} characters; search engines show about 60.`,
                fix: 'Shorten the title to 60 characters or fewer, or add a seoTitle of at most 60.',
              },
            ],
    },
  ],
  styleGuide: 'Short paragraphs, one idea per section, and an example for every claim.',
})

export default defineConfig({
  sites: {
    playground: {
      locales: ['es', 'en'],
      defaultLocale: 'es',
      collections: { blog },
      styleGuide: 'Spanish for Latin America, with tú, and plain international English.',
    },
  },
})
