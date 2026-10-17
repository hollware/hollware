import { afterAll, beforeAll, describe, expect, it } from 'vite-plus/test'

import { contentFixture } from '../../../../tests/fixtures/content.ts'
import { agentWith, createDraft, migrate, publishNew, seedOwnerToken } from './support.ts'
import { astroFetch, createAstroHarness } from './workers.ts'

// Fails when: @hollware/astro (packages/astro) stops letting an Astro site on Cloudflare read
// Hollware over its service binding at request time: the page of a published entry rendered with
// Astro's own `<Content />` from the HTML Hollware made (`hollwareLiveLoader`, `rendered.html`),
// the index from `getLiveCollection`; or it serves a draft, or an entry that does not exist, as
// anything but a 404, or lists a draft. The site is examples/astro-blog, built by Astro with
// @astrojs/cloudflare and no Node.js compatibility; content is published through MCP, as an
// agent does.

const server = createAstroHarness()

beforeAll(async () => {
  await server.listen()
  await migrate(server)
  const agent = agentWith(server, await seedOwnerToken(server))
  await publishNew(agent, {
    locale: 'en',
    slug: 'from-draft-to-published',
    markdown: contentFixture('blog/en/from-draft-to-published.md'),
  })
  await createDraft(agent, {
    locale: 'en',
    slug: 'markdown-as-source-of-truth',
    markdown: contentFixture('blog/en/markdown-as-source-of-truth.md'),
  })
})

afterAll(async () => {
  await server.close()
})

describe('an Astro site with @hollware/astro', () => {
  it('renders a published entry from the HTML Hollware made', async () => {
    const page = await astroFetch(server, '/blog/from-draft-to-published/')
    const html = await page.text()

    expect(page.status).toBe(200)
    expect(html).toContain('<title>From draft to published</title>')
    expect(html).toContain('<meta name="generator" content="Hollware">')
    // The body is the HTML of the entry, rendered by Astro's <Content />: its first heading.
    expect(html).toMatch(/<h1 id="from-draft-to-published"[^>]*>From draft to published<\/h1>/)
    expect(html).toContain('<h2 id="why-it-matters"')
  })

  it('lists the published entries, and not the draft', async () => {
    const html = await (await astroFetch(server, '/')).text()

    expect(html).toContain('href="/blog/from-draft-to-published/"')
    expect(html).toContain('From draft to published</a>')
    expect(html).not.toContain('markdown-as-source-of-truth')
  })

  it('answers a draft and an entry that does not exist with a 404', async () => {
    const draft = await astroFetch(server, '/blog/markdown-as-source-of-truth/')
    const missing = await astroFetch(server, '/blog/never-written/')

    expect([draft.status, missing.status]).toEqual([404, 404])
  })
})
