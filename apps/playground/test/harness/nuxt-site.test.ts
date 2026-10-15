import { afterAll, beforeAll, describe, expect, it } from 'vite-plus/test'

import { contentFixture } from '../../../../tests/fixtures/content.ts'
import { agentWith, createDraft, migrate, publishNew, seedOwnerToken } from './support.ts'
import { createNuxtHarness, nuxtFetch } from './workers.ts'

// Fails when: @hollware/nuxt (packages/nuxt) stops letting a Nuxt site on Cloudflare read
// Hollware over its service binding: the page of a published entry rendered on the server from
// its stored Comark document (`<HollwareContent>`, the `/_hollware/entry` route and
// `useHollwareEntry`), the index from `useHollwareEntries`, the generator meta of every page; or
// it serves a draft, or an entry that does not exist, as anything but a 404; or a page sends the
// browser the verdict and the last publication of an entry (`forPage`). The site is
// examples/nuxt-blog, built by Nuxt with the cloudflare_module preset and no Node.js
// compatibility; content is published through MCP, as an agent does.

const server = createNuxtHarness()

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

describe('a Nuxt site with @hollware/nuxt', () => {
  it('renders a published entry on the server, from its Comark document', async () => {
    const page = await nuxtFetch(server, '/blog/from-draft-to-published/')
    const html = await page.text()

    expect(page.status).toBe(200)
    expect(html).toContain('<title>From draft to published</title>')
    expect(html).toMatch(/<h1[^>]*>From draft to published<\/h1>/)
    // The body comes from the document: its first heading, rendered by @comark/vue.
    expect(html).toMatch(/<h1 id="from-draft-to-published"[^>]*>From draft to published<\/h1>/)
    expect(html).toContain('<meta name="generator" content="Hollware">')
    // The payload the page hands the browser holds what a reader sees, not how it was checked.
    expect(html).not.toContain('contractsHash')
    expect(html).not.toContain('lastPublication')
  })

  it('lists the published entries, and not the draft', async () => {
    const html = await (await nuxtFetch(server, '/')).text()

    expect(html).toContain('href="/blog/from-draft-to-published/"')
    expect(html).not.toContain('markdown-as-source-of-truth')
  })

  it('answers a draft and an entry that does not exist with a 404', async () => {
    const draft = await nuxtFetch(server, '/blog/markdown-as-source-of-truth/')
    const missing = await nuxtFetch(server, '/_hollware/entry/blog/en/never-written')

    expect([draft.status, missing.status]).toEqual([404, 404])
  })
})
