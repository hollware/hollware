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

// Fails when: hollware.com (apps/web) stops serving its docs from Hollware: a page of the docs
// site rendered on the server from its Comark document, with its `callout` as the site's own
// component and the sidebar in reading order (`readingOrder` of app/utils/docs.ts); a draft as a
// 404; the Markdown of a page at /docs/<slug>.md (server/middleware/markdown.ts); llms.txt with
// every page in reading order; the MCP tools page, and its Markdown, generated from @hollware/core; or the landing
// page with the install command. In Spanish (under /es/, app/composables/useLocale.ts): the site's
// own words, `<html lang="es">` and the alternates of each language; a page of the docs read in
// Spanish, or in English with a notice while it is not translated; its Markdown at
// /es/docs/<slug>.md. The docs are written through MCP to the site `docs`, as an agent writes them.

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
    // The callout of the docs, as the site's DocsCallout draws it.
    expect(html).toMatch(/data-slot="title"[^>]*><!--\[-->Tip<!--\]-->/)
    // Getting started comes before Concepts, whatever the order of publication.
    expect(html.indexOf('>First steps<')).toBeLessThan(html.indexOf('>A concept<'))
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

  it('lists every page for language models, in reading order', async () => {
    const llms = await webFetch(server, '/llms.txt')
    const text = await llms.text()
    // A route of the site's own that reads through useHollware is tagged by the reader (S8).
    expect((llms.headers.get('cache-tag') ?? '').split(',')).toContain('list:docs:en')

    expect(text).toContain(
      '- [First steps](https://hollware.com/docs/first-steps.md): The page First steps of the docs, written by a test.\n- [A concept](https://hollware.com/docs/a-concept.md)',
    )
    expect(text).not.toContain('unfinished')
  })

  it('generates the reference of the MCP tools, and shows the install command at home', async () => {
    const tools = await (await webFetch(server, '/reference/mcp-tools/')).text()
    const home = await (await webFetch(server, '/')).text()

    expect(tools).toContain('The 32 tools of')
    expect(tools).toContain('id="create_draft"')
    const markdown = await webFetch(server, '/reference/mcp-tools.md')
    const text = await markdown.text()
    expect(markdown.headers.get('content-type')).toBe('text/markdown; charset=utf-8')
    expect(text.match(/^## /gm)).toHaveLength(32)
    expect(text).toContain('## create_draft')
    expect(home).toContain('npm create hollware my-cms')
    expect(home).toContain('<meta name="generator" content="Hollware">')
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
    // The sidebar in Spanish: its sections, its links, and the page that is only in English.
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
