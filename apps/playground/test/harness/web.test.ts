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
    expect(apiMarkdown.match(/^## GET /gm)).toHaveLength(6)
    expect(apiMarkdown).toContain('## GET /v1/search')
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

  it('generates the reference of the MCP tools, and shows the install command and every use case at home', async () => {
    const tools = await (await webFetch(server, '/reference/mcp-tools/')).text()
    const home = await (await webFetch(server, '/')).text()

    expect(tools).toContain('The 40 tools of')
    expect(tools).toContain('id="create_draft"')
    const markdown = await webFetch(server, '/reference/mcp-tools.md')
    const text = await markdown.text()
    expect(markdown.headers.get('content-type')).toBe('text/markdown; charset=utf-8')
    expect(text.match(/^## /gm)).toHaveLength(40)
    expect(text).toContain('## create_draft')
    expect(home).toContain('npm create hollware@rc my-cms')
    expect(home).toContain('<meta name="generator" content="Hollware">')
    expect(home).toContain('<meta property="og:image" content="https://hollware.com/og.png">')
    expect(home).toContain(
      '<meta property="og:title" content="Hollware: the CMS your agents write to">',
    )
    expect(home).toMatch(
      /<meta property="og:description" content="Hollware is an open-source headless CMS/,
    )
    expect(tools).toContain('<meta property="og:title" content="MCP tools · Hollware">')
    const page = await (await webFetch(server, '/docs/first-steps/')).text()
    expect(page).toContain('<meta property="og:title" content="First steps · Hollware">')
    const image = await webFetch(server, '/og.png')
    expect([image.status, image.headers.get('content-type')]).toEqual([200, 'image/png'])
    expect(home.match(/role="tabpanel"/g)).toHaveLength(6)
    expect(home).toContain('Docs that follow the code')
    expect(home).toContain('40 MCP tools, each with the scopes it needs.')
    expect(home).not.toContain('main door')
    const opening = home.indexOf('Every refusal carries its fix')
    expect(opening).toBeGreaterThan(-1)
    expect(opening).toBeLessThan(
      home.indexOf('From a prompt to a live page, with checks in between'),
    )
  })

  it('speaks Spanish under /es/: its words, its language and the alternates of each page', async () => {
    const home = await (await webFetch(server, '/es/')).text()

    expect(home).toMatch(/<html[^>]* lang="es"/)
    expect(home).toContain('El CMS en el que escriben tus')
    expect(home).toContain('href="/es/docs/"')
    expect(home).toContain('<link rel="alternate" hreflang="en" href="https://hollware.com/">')
    expect(home).toContain('<link rel="alternate" hreflang="es" href="https://hollware.com/es/">')
    expect(await (await webFetch(server, '/')).text()).toMatch(/<html[^>]* lang="en"/)
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
