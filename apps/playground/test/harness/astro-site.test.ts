import { afterAll, beforeAll, describe, expect, it } from 'vite-plus/test'

import { contentFixture } from '../../../../tests/fixtures/content.ts'
import {
  agentWith,
  createDraft,
  migrate,
  previewTokenFor,
  publishNew,
  seedOwnerToken,
} from './support.ts'
import { astroFetch, createAstroHarness } from './workers.ts'

// Fails when: @hollware/astro (packages/astro) stops letting an Astro site on Cloudflare read
// Hollware over its service binding at request time: the page of a published entry rendered with
// Astro's own `<Content />` from the HTML Hollware made (`hollwareLiveLoader`, `rendered.html`),
// the index from `getLiveCollection`; or it serves a draft, or an entry that does not exist, as
// anything but a 404 (but for a preview token of that entry, which serves its latest revision
// with `no-store`, T-103; a token that is expired, forged or for another entry serves nothing), or lists a draft. The site is examples/astro-blog, built by Astro with
// @astrojs/cloudflare and no Node.js compatibility; content is published through MCP, as an
// agent does.

let draftId = ''
let publishedId = ''

const server = createAstroHarness()

beforeAll(async () => {
  await server.listen()
  await migrate(server)
  const agent = agentWith(server, await seedOwnerToken(server))
  publishedId = await publishNew(agent, {
    locale: 'en',
    slug: 'from-draft-to-published',
    markdown: contentFixture('blog/en/from-draft-to-published.md'),
  })
  draftId = (
    await createDraft(agent, {
      locale: 'en',
      slug: 'markdown-as-source-of-truth',
      markdown: contentFixture('blog/en/markdown-as-source-of-truth.md'),
    })
  ).id
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

  it('serves a draft with the preview token of that entry, and never keeps the page', async () => {
    const path = '/blog/markdown-as-source-of-truth/'
    const token = await previewTokenFor(draftId)

    const without = await astroFetch(server, path)
    const previewed = await astroFetch(server, `${path}?hollware-preview=${token}`)
    const html = await previewed.text()

    expect(without.status).toBe(404)
    expect(previewed.status).toBe(200)
    expect(html).toContain('Markdown as the source of truth</title>')
    expect(previewed.headers.get('cache-control')).toBe('no-store')
    expect(previewed.headers.get('cache-tag')).toBeNull()
    expect(previewed.headers.get('cloudflare-cdn-cache-control')).toBeNull()
  })

  it('does not show the draft for a token that is expired, forged or for another entry', async () => {
    const path = '/blog/markdown-as-source-of-truth/'
    const tokens = [
      await previewTokenFor(draftId, { ageSeconds: 3601 }),
      await previewTokenFor(draftId, { secret: 'x'.repeat(40) }),
      await previewTokenFor(publishedId),
      'hw_prv_nonsense',
    ]

    const answers = await Promise.all(
      tokens.map((token) => astroFetch(server, `${path}?hollware-preview=${token}`)),
    )
    const bodies = await Promise.all(answers.map((answer) => answer.text()))

    expect(answers.map((answer) => answer.status)).toEqual([404, 404, 404, 404])
    expect(bodies.some((body) => body.includes('Markdown as the source of truth'))).toBe(false)
    expect(answers.map((answer) => answer.headers.get('cache-control'))).toEqual([
      'no-store',
      'no-store',
      'no-store',
      'no-store',
    ])
  })

  it('never answers the published version in place of a token that does not hold', async () => {
    const path = '/blog/from-draft-to-published/'
    const token = await previewTokenFor(draftId)

    const answer = await astroFetch(server, `${path}?hollware-preview=${token}`)

    expect(answer.status).toBe(404)
    expect(await answer.text()).not.toContain('From draft to published')
  })
})
