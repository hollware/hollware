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
    // A title of at most 60 characters, or a seoTitle, which search engines show.
    contracts.fieldLength(
      { field: 'title', max: 60, unless: 'seoTitle' },
      { severity: 'warning', id: 'seo-title-length' },
    ),
  ],
  styleGuide: 'Short paragraphs, one idea per section, and an example for every claim.',
})

/**
 * The weekly reports of the auditor of @hollware/agents (v0.6): drafts that a person reads in the
 * admin, never published, so no site has a page for them.
 */
const reports = defineCollection({
  schema: z.object({
    title: z.string().min(1),
    description: z.string().min(1).max(200),
  }),
  routes: { es: '/informes/:slug/', en: '/en/reports/:slug/' },
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
    section: z.enum(['start', 'guides', 'frameworks', 'concepts', 'reference']),
    order: z.number().int().min(0).max(999),
  }),
  routes: { en: '/docs/:slug/', es: '/es/docs/:slug/' },
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
      locales: ['en', 'es'],
      defaultLocale: 'en',
      url: 'https://hollware.com',
      collections: { docs },
      styleGuide:
        'Plain international English, and neutral Spanish with tú and no regional idioms. A page in Spanish keeps the slug of its English page.',
    },
    playground: {
      locales: ['es', 'en'],
      defaultLocale: 'es',
      // The blog of the demo (examples/nuxt-blog), served at this url.
      url: 'https://demo.hollware.com',
      collections: { blog, reports },
      styleGuide: 'Spanish for Latin America, with tú, and plain international English.',
    },
  },
})
