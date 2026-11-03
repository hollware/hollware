import {
  contracts,
  defineCollection,
  defineComponent,
  defineConfig,
  OPERATIONS,
} from '@hollware/core'
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
  navigation: { groupBy: 'section', orderBy: 'order' },
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

const VOICE = [
  'AI-[p]owered',
  'auto[p]ilot',
  'seam[l]ess',
  'seam[l]essly',
  'un[l]eash',
  'un[l]eashes',
  'un[l]eashed',
  'un[l]eashing',
  'next-[g]en',
  'b[l]azing fast',
  'b[l]azingly fast',
  'spo[o]ky',
  'is [f]ree',
  'for [f]ree',
  "it's [f]ree",
  '[f]ree to start',
  'zero [c]ost',
  'gr[a]tis',
  'sin [p]agar',
].map((word) => word.replace(/[[\]]/g, ''))

const ICONS = z.enum([
  'shield-check',
  'git-pull-request',
  'plug',
  'cloud',
  'layout-template',
  'bot',
  'book-open',
  'scale',
  'file-text',
  'search',
  'languages',
  'database',
  'history',
  'users',
])

const NONE = z.strictObject({})

const PAGE_COMPONENTS = {
  hero: defineComponent({
    props: NONE,
    description:
      'The opening of a page: #eyebrow, #title (the h1), #lead, #session (an agent-session) and the default slot (an install-prompt).',
    example:
      '::hero\n#eyebrow\nThe CMS your agents write to\n\n#title\nLet your agents publish.\n\n#lead\nContracts check every write.\n::',
  }),
  section: defineComponent({
    props: z.strictObject({ id: z.string().regex(/^[a-z][a-z0-9-]*$/) }),
    description: 'A section of a page, with #eyebrow, #title (an h2), #lead and its content.',
    example: '::section{id="how-it-works"}\n#title\nHow it works\n\n#default\nFour calls.\n::',
  }),
  'agent-session': defineComponent({
    props: NONE,
    description:
      'An agent at work, as a fenced code block with one event per line: "> tool args" a call, "< text" an answer, "! path message" a refusal, "? text" its fix, "@ text" a person, "✓ text" done.',
    example: '::agent-session\n```text\n> create_draft blog/en/launch\n✓ saved, version 1\n```\n::',
  }),
  'install-prompt': defineComponent({
    props: NONE,
    description:
      'The button that copies the sentence of its default slot, a prompt for an agent, with a tab for each agent; #note goes under it.',
    example:
      '::install-prompt\nInstall Hollware in my Cloudflare account following https://hollware.com/install.md\n::',
  }),
  facts: defineComponent({
    props: NONE,
    description: 'A strip of short facts: a list, each item one fact.',
    example: '::facts\n- MIT\n- :fact{name="tools"} MCP tools\n::',
  }),
  fact: defineComponent({
    props: z.strictObject({ name: z.enum(['tools', 'version', 'license']) }),
    description:
      'A fact of Hollware itself, read from its code: tools (how many MCP tools), version, license.',
    example: ':fact{name="version"}',
  }),
  problems: defineComponent({
    props: NONE,
    description: 'A list of problem blocks.',
    example:
      '::problems\n:::problem{icon="shield-check"}\n#problem\nAn agent publishes a broken page.\n:::\n::',
  }),
  problem: defineComponent({
    props: z.strictObject({ icon: ICONS }),
    description: 'A problem and what Hollware does about it: #problem, #solution and #example.',
    example:
      ':::problem{icon="shield-check"}\n#problem\nAn agent publishes a broken page.\n\n#solution\nContracts check every write.\n:::',
  }),
  'chaos-order': defineComponent({
    props: NONE,
    description: 'A write before and after its fix: #before and #after, each a code block.',
    example:
      '::chaos-order\n#before\n```text\n! /frontmatter/title missing\n```\n\n#after\n```text\n✓ ok\n```\n::',
  }),
  steps: defineComponent({
    props: NONE,
    description: 'Numbered steps, each a step component.',
    example: '::steps\n:::step{tool="create_draft"}\nThe agent writes a draft.\n:::\n::',
  }),
  step: defineComponent({
    props: z.strictObject({ tool: z.enum(OPERATIONS.map((operation) => operation.name)) }),
    description: 'One step, named after the MCP tool it calls.',
    example: ':::step{tool="publish"}\nA person publishes.\n:::',
  }),
  stack: defineComponent({
    props: NONE,
    description:
      'A grid of the products a page names: a list, each item a sentence that starts with the name in bold, "**Workers** run Hollware".',
    example: '::stack\n- **Workers** run Hollware\n::',
  }),
  cards: defineComponent({
    props: NONE,
    description: 'A grid of card components.',
    example: '::cards\n:::card{icon="bot"}\n[Agents](/features/agents/)\n\n41 tools.\n:::\n::',
  }),
  card: defineComponent({
    props: z.strictObject({ icon: ICONS }),
    description:
      'A card that leads to a page of this site: its first line is a link with the title, the rest describes it.',
    example:
      ':::card{icon="git-pull-request"}\n[Review](/features/review/)\n\nA person decides.\n:::',
  }),
  faq: defineComponent({
    props: NONE,
    description: 'Questions and answers: each question an h3, its answer the paragraphs after it.',
    example: '::faq\n### Is it open source?\nYes, MIT.\n::',
  }),
  cta: defineComponent({
    props: NONE,
    description: 'The closing call to action: #title and an install-prompt in the default slot.',
    example: '::cta\n#title\nGive your agents a CMS\n::',
  }),
  callout: defineComponent({
    props: z.strictObject({ type: z.enum(['note', 'tip', 'warning']) }),
    description: 'A note beside the flow of the text: something to keep in mind, or to avoid.',
    example: '::callout{type="warning"}\nNever commit a token.\n::',
  }),
  'brand-assets': defineComponent({
    props: NONE,
    description: 'The logos of Hollware to download, its colors and its fonts.',
    example: '::brand-assets\n::',
  }),
  'copy-block': defineComponent({
    props: NONE,
    description: 'A text to copy with one click: #label names it, the default slot is the text.',
    example: '::copy-block\n#label\nOne line\n\n#default\nThe CMS your agents write to.\n::',
  }),
}

const PAGE_CONTRACTS = [
  contracts.bannedWords({
    words: VOICE,
    reason: 'say what happens, and promise no price: apps/web/AGENTS.md',
  }),
  contracts.internalLinksResolve(),
  contracts.imagesHaveAlt(),
  contracts.fieldLength(
    { field: 'title', max: 60, unless: 'seoTitle' },
    { severity: 'warning', id: 'seo-title-length' },
  ),
]

const PAGE_STYLE = [
  'Write for a developer who builds with agents and is choosing a CMS.',
  'Say what happens, with its mechanism and its numbers, never the feeling. Promise no price.',
  'Agents write, read and ask for review; a person decides. Short sentences, active voice.',
  'English first; the Spanish page is a careful translation with the same slug, not a new text.',
  'Copy goes in the body and in the slots of components, never in their props.',
].join(' ')

const pageFields = {
  title: z.string().min(1).max(90),
  seoTitle: z.string().min(1).max(60).optional(),
  description: z.string().min(1).max(160),
}

const pages = defineCollection({
  schema: z.object({ ...pageFields, noindex: z.boolean().optional() }),
  routes: { en: '/:slug/', es: '/es/:slug/' },
  components: PAGE_COMPONENTS,
  contracts: PAGE_CONTRACTS,
  styleGuide: PAGE_STYLE,
})

const features = defineCollection({
  schema: z.object({ ...pageFields, order: z.number().int().min(0).max(99), icon: ICONS }),
  routes: { en: '/features/:slug/', es: '/es/features/:slug/' },
  components: PAGE_COMPONENTS,
  contracts: PAGE_CONTRACTS,
  styleGuide: PAGE_STYLE,
})

const compare = defineCollection({
  schema: z.object({
    ...pageFields,
    order: z.number().int().min(0).max(99),
    products: z.array(z.string().min(1).max(40)).min(1).max(4),
    sources: z
      .array(z.string().regex(/^https:\/\/\S+$/))
      .min(1)
      .max(20),
    reviewed: z.iso.date(),
  }),
  routes: { en: '/compare/:slug/', es: '/es/compare/:slug/' },
  components: PAGE_COMPONENTS,
  contracts: PAGE_CONTRACTS,
  styleGuide: `${PAGE_STYLE} A comparison is fair: every claim about another product has a public source in sources, and reviewed is the day they were read.`,
})

const glossary = defineCollection({
  schema: z.object({
    ...pageFields,
    term: z.string().min(1).max(60),
    alternateNames: z.array(z.string().min(1).max(60)).max(5).optional(),
  }),
  routes: { en: '/glossary/:slug/', es: '/es/glossary/:slug/' },
  components: PAGE_COMPONENTS,
  contracts: PAGE_CONTRACTS,
  styleGuide: `${PAGE_STYLE} A term is defined in its first sentence, plainly enough to be quoted.`,
})

export default defineConfig({
  sites: {
    docs: {
      locales: ['en', 'es'],
      defaultLocale: 'en',
      url: 'https://hollware.com',
      collections: { docs, pages, features, compare, glossary },
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
