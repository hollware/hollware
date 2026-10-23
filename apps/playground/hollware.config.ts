import { contracts, defineCollection, defineComponent, defineConfig } from '@hollware/core'
import * as z from 'zod'

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
    contracts.translationPair({ severity: 'warning' }),
    contracts.internalLinksResolve({ severity: 'warning' }),
    contracts.imagesHaveAlt(),
    contracts.fieldLength(
      { field: 'title', max: 60, unless: 'seoTitle' },
      { severity: 'warning', id: 'seo-title-length' },
    ),
  ],
  styleGuide: 'Short paragraphs, one idea per section, and an example for every claim.',
})

const reports = defineCollection({
  schema: z.object({
    title: z.string().min(1),
    description: z.string().min(1).max(200),
  }),
  routes: { es: '/informes/:slug/', en: '/en/reports/:slug/' },
})

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
      url: 'https://demo.hollware.com',
      collections: { blog, reports },
      styleGuide: 'Spanish for Latin America, with tú, and plain international English.',
    },
  },
})
