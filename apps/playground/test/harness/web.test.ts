import { afterAll, beforeAll, describe, expect, it } from 'vite-plus/test'

import {
  agentWith,
  ALL_SCOPES,
  createDraft,
  migrate,
  publishNew,
  seedOwnerToken,
} from './support.ts'
import { createWebHarness, webFetch } from './workers.ts'

const server = createWebHarness()

const page = (title: string, section: string, order: number, body: string) =>
  [
    '---',
    `title: ${title}`,
    `description: The page ${title} of the docs, written by a test.`,
    `section: ${section}`,
    `order: ${order}`,
    '---',
    '',
    `# ${title}`,
    '',
    body,
    '',
  ].join('\n')

const HOME = {
  en: [
    '---',
    'title: Let your agents publish.',
    'seoTitle: "Hollware: the CMS your agents write to"',
    'description: Hollware is an open-source headless CMS, written by a test.',
    '---',
    '',
    '::hero',
    '#eyebrow',
    'The CMS your agents write to',
    '',
    '#title',
    'Let your agents publish.',
    '',
    '#default',
    ':::install-prompt',
    'Install Hollware following https://hollware.com/install.md',
    ':::',
    '',
    '#session',
    ':::agent-session',
    '```text',
    '> create_draft blog/en/launch',
    '! /frontmatter/description: missing',
    '```',
    ':::',
    '::',
    '',
    '::section{id="admin"}',
    '#title',
    'Where a person has the last word',
    '',
    '#default',
    '![The Reviews page of the Hollware admin](/admin-review.webp)',
    '',
    'Start with [the first steps](/docs/first-steps/), :fact{name="tools"} tools.',
    '::',
    '',
    '::faq',
    '### Is it open source?',
    'Yes, MIT.',
    '::',
    '',
  ].join('\n'),
  es: [
    '---',
    'title: Deja que tus agentes publiquen.',
    'description: Hollware es un CMS headless de código abierto, escrito por un test.',
    '---',
    '',
    '::hero',
    '#eyebrow',
    'El CMS en el que escriben tus agentes',
    '',
    '#title',
    'Deja que tus agentes publiquen.',
    '::',
    '',
    'Empieza por [los primeros pasos](/es/docs/first-steps/).',
    '',
  ].join('\n'),
}

const FEATURE = [
  '---',
  'title: Agents and MCP',
  'description: The agents of Hollware, written by a test.',
  'order: 1',
  'icon: bot',
  '---',
  '',
  'Every tool asks for one scope.',
  '',
].join('\n')

const MEDIA_KIT = [
  '---',
  'title: Media kit',
  'description: The logos of Hollware, written by a test.',
  'noindex: true',
  '---',
  '',
  '::copy-block',
  '#label',
  'One line',
  '',
  '#default',
  'Hollware is the CMS your agents write to.',
  '::',
  '',
].join('\n')

beforeAll(async () => {
  await server.listen()
  await migrate(server)
  const agent = agentWith(server, await seedOwnerToken(server, ALL_SCOPES, 'docs'))
  await publishNew(agent, {
    collection: 'docs',
    locale: 'en',
    slug: 'a-concept',
    markdown: page('A concept', 'concepts', 1, 'One idea, in a few words.'),
  })
  await publishNew(agent, {
    collection: 'docs',
    locale: 'en',
    slug: 'first-steps',
    markdown: page(
      'First steps',
      'start',
      1,
      '## Install\n\n```sh\nnpm create hollware my-cms\n```\n\n::callout{type="tip"}\nKeep the token.\n::',
    ),
  })
  await publishNew(agent, {
    collection: 'docs',
    locale: 'es',
    slug: 'first-steps',
    markdown: page('Primeros pasos', 'start', 1, '## Instalar\n\nUn comando.'),
  })
  await publishNew(agent, {
    collection: 'docs',
    locale: 'en',
    slug: 'a-framework',
    markdown: page('A framework', 'frameworks', 1, 'How one framework reads Hollware.'),
  })
  await createDraft(agent, {
    collection: 'docs',
    locale: 'en',
    slug: 'unfinished',
    markdown: page('Unfinished', 'guides', 1, 'Not yet.'),
  })
  for (const locale of ['en', 'es'] as const) {
    await publishNew(agent, { collection: 'pages', locale, slug: 'home', markdown: HOME[locale] })
  }
  await publishNew(agent, {
    collection: 'features',
    locale: 'en',
    slug: 'agents',
    markdown: FEATURE,
  })
  await publishNew(agent, {
    collection: 'pages',
    locale: 'en',
    slug: 'media-kit',
    markdown: MEDIA_KIT,
  })
})

afterAll(async () => {
  await server.close()
})

describe('hollware.com', () => {
  it('renders a page of the docs from Hollware, with its callout and the sidebar in order', async () => {
    const response = await webFetch(server, '/docs/first-steps/')
    const html = await response.text()

    expect(response.status).toBe(200)
    expect(html).toContain('<title>First steps · Hollware</title>')
    expect(html).toContain('<h2 id="install">Install</h2>')
    expect(html).toContain('Keep the token.')
    expect(html).toMatch(/data-slot="title"[^>]*><!--\[-->Tip<!--\]-->/)
    expect(html.indexOf('>First steps<')).toBeLessThan(html.indexOf('>A framework<'))
    expect(html.indexOf('>A framework<')).toBeLessThan(html.indexOf('>A concept<'))
    expect(html).toContain('>Frameworks<')
    expect(html).not.toContain('Unfinished')
  })

  it('answers a draft with a 404, and serves the Markdown of a page', async () => {
    const draft = await webFetch(server, '/docs/unfinished/')
    const markdown = await webFetch(server, '/docs/a-concept.md')

    expect(draft.status).toBe(404)
    expect(markdown.headers.get('content-type')).toBe('text/markdown; charset=utf-8')
    expect(await markdown.text()).toBe(
      page('A concept', 'concepts', 1, 'One idea, in a few words.'),
    )
  })

  it('generates the references of the read API and of the webhook events, as pages and as Markdown', async () => {
    const api = await (await webFetch(server, '/reference/read-api/')).text()
    const events = await (await webFetch(server, '/reference/events/')).text()
    const apiMarkdown = await (await webFetch(server, '/reference/read-api.md')).text()
    const eventsMarkdown = await (await webFetch(server, '/reference/events.md')).text()
    const llms = await (await webFetch(server, '/llms.txt')).text()

    expect(api).toContain('id="get_entry"')
    expect(api).toContain('/v1/{collection}/{locale}/{slug}')
    expect(api).toContain('href="/reference/events/"')
    expect(apiMarkdown.match(/^## GET /gm)).toHaveLength(7)
    expect(apiMarkdown).toContain('## GET /v1/search')
    expect(apiMarkdown).toContain('## GET /v1/{collection}/navigation')
    expect(api).toContain('id="get_navigation"')
    expect(events).toContain('id="review.requested"')
    expect(events).toContain('hollware-signature')
    expect(eventsMarkdown).toContain('## review.requested, review.decided')
    expect(eventsMarkdown).toContain(
      '- `adminPath` (string): Where a person reads the review in the admin, under the URL of this Hollware.',
    )
    expect(llms).toContain('- [Read API](https://hollware.com/reference/read-api.md)')
    expect(llms).toContain('- [Webhook events](https://hollware.com/reference/events.md)')
  })

  it('lists every page for language models, in reading order', async () => {
    const llms = await webFetch(server, '/llms.txt')
    const text = await llms.text()
    expect((llms.headers.get('cache-tag') ?? '').split(',')).toContain('list:docs:en')

    expect(text).toContain(
      '- [First steps](https://hollware.com/docs/first-steps.md): The page First steps of the docs, written by a test.\n- [A framework](https://hollware.com/docs/a-framework.md): The page A framework of the docs, written by a test.\n- [A concept](https://hollware.com/docs/a-concept.md)',
    )
    expect(text).not.toContain('unfinished')
  })

  it('generates the reference of the MCP tools, and reads the home from the pages of Hollware', async () => {
    const tools = await (await webFetch(server, '/reference/mcp-tools/')).text()
    const home = await (await webFetch(server, '/')).text()

    expect(tools).toContain('The 41 tools of')
    expect(tools).toContain('id="create_draft"')
    const markdown = await webFetch(server, '/reference/mcp-tools.md')
    const text = await markdown.text()
    expect(markdown.headers.get('content-type')).toBe('text/markdown; charset=utf-8')
    expect(text.match(/^## /gm)).toHaveLength(41)
    expect(text).toContain('## create_draft')
    expect(text).toContain('## get_review')
    expect(home).toContain('<meta name="generator" content="Hollware">')
    expect(home).toContain('<meta property="og:image" content="https://hollware.com/og.png">')
    expect(home).toContain(
      '<meta property="og:title" content="Hollware: the CMS your agents write to">',
    )
    expect(home).toContain('<link rel="canonical" href="https://hollware.com/">')
    expect(home).toContain('Install Hollware following https://hollware.com/install.md')
    expect(home).toContain('create_draft blog/en/launch')
    expect(home).toMatch(/>41(?:<!--[^>]*-->)*<\/span>(?:<!--[^>]*-->)* tools/)
    expect(home).toContain('"@type":"FAQPage"')
    expect(home).toContain('"name":"Is it open source?"')
    expect(tools).toContain('<meta property="og:title" content="MCP tools · Hollware">')
    const page = await (await webFetch(server, '/docs/first-steps/')).text()
    expect(page).toContain('<meta property="og:title" content="First steps · Hollware">')
    const image = await webFetch(server, '/og.png')
    expect([image.status, image.headers.get('content-type')]).toEqual([200, 'image/png'])
  })

  it('shows the admin at home as an image the site serves, and sends /home/ to the home', async () => {
    const home = await (await webFetch(server, '/')).text()
    const image = await webFetch(server, '/admin-review.webp')
    const preview = await webFetch(server, '/home/?hollware-preview=x', 'manual')

    expect(home).toMatch(
      /<img src="\/admin-review\.webp" alt="The Reviews page of the Hollware admin"/,
    )
    expect([image.status, image.headers.get('content-type')]).toEqual([200, 'image/webp'])
    expect([preview.status, preview.headers.get('location')]).toEqual([302, '/?hollware-preview=x'])
  })

  it('speaks Spanish under /es/: its words, its language and the alternates of each page', async () => {
    const home = await (await webFetch(server, '/es/')).text()

    expect(home).toMatch(/<html[^>]* lang="es"/)
    expect(home).toContain('El CMS en el que escriben tus agentes')
    expect(home).toContain('href="/es/docs/"')
    expect(home).toContain('<link rel="alternate" hreflang="en" href="https://hollware.com/">')
    expect(home).toContain('<link rel="alternate" hreflang="es" href="https://hollware.com/es/">')
    expect(await (await webFetch(server, '/')).text()).toMatch(/<html[^>]* lang="en"/)
  })

  it('keeps the media kit out of search, and lists every other page in the sitemap and as Markdown', async () => {
    const kit = await webFetch(server, '/media-kit/')
    const sitemap = await (await webFetch(server, '/sitemap.xml')).text()
    const robots = await (await webFetch(server, '/robots.txt')).text()
    const feature = await webFetch(server, '/features/agents.md')
    const llms = await (await webFetch(server, '/llms.txt')).text()

    expect(kit.headers.get('x-robots-tag')).toBe('noindex')
    expect(await kit.text()).toContain('<meta name="robots" content="noindex, follow">')
    expect(sitemap).toContain('<loc>https://hollware.com/features/agents/</loc>')
    expect(sitemap).toContain('<loc>https://hollware.com/docs/first-steps/</loc>')
    expect(sitemap).not.toContain('media-kit')
    expect(robots).toContain('Sitemap: https://hollware.com/sitemap.xml')
    expect(await feature.text()).toBe(FEATURE)
    expect(llms).toContain('- [Agents and MCP](https://hollware.com/features/agents.md)')
    expect(llms).not.toContain('media-kit')
  })

  it('reads a page of the docs in Spanish, or in English with a notice until it is translated', async () => {
    const translated = await (await webFetch(server, '/es/docs/first-steps/')).text()
    const english = await webFetch(server, '/es/docs/a-concept/')
    const html = await english.text()

    expect(translated).toContain('<title>Primeros pasos · Hollware</title>')
    expect(translated).toContain('<h2 id="instalar">Instalar</h2>')
    expect(translated).not.toContain('todavía no está traducida')
    expect(translated).toContain('Primeros pasos</')
    expect(translated).toContain('href="/es/docs/a-concept/"')
    expect(english.status).toBe(200)
    expect(html).toContain('One idea, in a few words.')
    expect(html).toContain('Esta página todavía no está traducida al español')
    expect(html).toContain('lang="en"')
    expect((await webFetch(server, '/es/docs/unfinished/')).status).toBe(404)
  })

  it('serves the Markdown of a page in Spanish', async () => {
    const markdown = await webFetch(server, '/es/docs/first-steps.md')

    expect(markdown.headers.get('content-type')).toBe('text/markdown; charset=utf-8')
    expect(await markdown.text()).toBe(
      page('Primeros pasos', 'start', 1, '## Instalar\n\nUn comando.'),
    )
    expect((await webFetch(server, '/es/docs/a-concept.md')).status).toBe(404)
  })
})
