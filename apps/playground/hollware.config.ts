import { contracts, defineCollection, defineComponent, defineConfig } from '@hollware/core'
import * as z from 'zod'

/**
 * The playground's config, which the demo deployment runs too: a bilingual blog, the site the
 * tests write to and read from, and the documentation of hollware.com. Its corpus is tests/fixtures/content/blog, and its broken variants are
 * tests/fixtures/content/invalid, each of which breaks one of the contracts below.
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
    // A post may go out in one language first: publishing it asks to acknowledge the other.
    contracts.translationPair({ severity: 'warning' }),
    // A warning, not an error: two drafts that link to each other could never be published, since
    // each would wait for the other to be published first.
    contracts.internalLinksResolve({ severity: 'warning' }),
    contracts.imagesHaveAlt(),
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

/**
 * The documentation of hollware.com (v0.4): written in Hollware by agents and people, and read
 * by the site over a service binding. A page belongs to a section of the sidebar, and `order` is
 * its place in it.
 */
const docs = defineCollection({
  schema: z.object({
    title: z.string().min(1).max(70),
    description: z.string().min(1).max(160),
    section: z.enum(['start', 'guides', 'concepts', 'reference']),
    order: z.number().int().min(0).max(999),
  }),
  routes: { en: '/docs/:slug/' },
  components: {
    callout: defineComponent({
      props: z.strictObject({ type: z.enum(['note', 'tip', 'warning']) }),
      description: 'A note beside the flow of the text: something to keep in mind, or to avoid.',
      example: '::callout{type="warning"}\nNever commit a token.\n::',
    }),
  },
  contracts: [contracts.internalLinksResolve({ severity: 'warning' }), contracts.imagesHaveAlt()],
  styleGuide: [
    'Write for a developer who has never heard of Hollware and wants it running today.',
    'Second person, present tense, short sentences. One task or one idea per page.',
    'Every command is in a code block, ready to paste, with its language. Show the output when it',
    'tells the reader something. No marketing words: say what it does.',
  ].join(' '),
})

export default defineConfig({
  sites: {
    docs: {
      locales: ['en'],
      defaultLocale: 'en',
      url: 'https://hollware.com',
      collections: { docs },
      styleGuide: 'Plain international English.',
    },
    playground: {
      locales: ['es', 'en'],
      defaultLocale: 'es',
      // The blog of the demo (examples/nuxt-blog): its pages count their views here (ADR-031).
      url: 'https://demo.hollware.com',
      collections: { blog },
      styleGuide: 'Spanish for Latin America, with tú, and plain international English.',
    },
  },
})
