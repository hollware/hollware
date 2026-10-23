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

const MANUAL = { redirect: 'manual' } as const
const CLEARED = 'hollware_preview=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0'

function cookie(token: string) {
  return { headers: { cookie: `hollware_preview=${token}` } }
}

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
  it('renders a published entry from its document, its callout as a component of the site', async () => {
    const page = await astroFetch(server, '/blog/from-draft-to-published/')
    const html = await page.text()

    expect(page.status).toBe(200)
    expect(html).toContain('<title>From draft to published</title>')
    expect(html).toContain('<meta name="generator" content="Hollware">')
    expect(html).toMatch(/<h1 id="from-draft-to-published"[^>]*>From draft to published<\/h1>/)
    expect(html).toContain('<h2 id="why-it-matters"')
    expect(html).toContain('<strong>fast reads</strong>')
    expect(html).toMatch(
      /<aside class="callout" data-type="tip"[^>]*>\s*(<p>)?Keep the slug short: it becomes part of the public path\.(<\/p>)?\s*<\/aside>/,
    )
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

  it('exchanges the preview link for a cookie and a redirect to the same URL without it', async () => {
    const path = '/blog/markdown-as-source-of-truth/'
    const token = await previewTokenFor(draftId)

    const answer = await astroFetch(server, `${path}?a=1&hollware-preview=${token}&b=2`, MANUAL)

    expect(answer.status).toBe(303)
    expect(answer.headers.get('location')).toMatch(
      new RegExp(`^${path}\\?a=1&b=2&hollware-view=[A-Za-z0-9_-]{12}$`),
    )
    expect(answer.headers.get('set-cookie')).toBe(
      `hollware_preview=${token}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=3600`,
    )
    expect(answer.headers.get('cache-control')).toBe('no-store')
    expect(answer.headers.get('referrer-policy')).toBe('no-referrer')
  })

  it('sets no cookie for a value that is not shaped like a token, and redirects anyway', async () => {
    const path = '/blog/markdown-as-source-of-truth/'

    const answer = await astroFetch(server, `${path}?hollware-preview=hw_prv_nonsense`, MANUAL)

    expect(answer.status).toBe(303)
    expect(answer.headers.get('location')).toBe(path)
    expect(answer.headers.get('set-cookie')).toBeNull()
  })

  it('serves a draft with the cookie of that entry, and never keeps the page', async () => {
    const path = '/blog/markdown-as-source-of-truth/'
    const token = await previewTokenFor(draftId)

    const without = await astroFetch(server, path)
    const previewed = await astroFetch(server, path, cookie(token))
    const html = await previewed.text()

    expect(without.status).toBe(404)
    expect(previewed.status).toBe(200)
    expect(html).toContain('Markdown as the source of truth</title>')
    expect(previewed.headers.get('cache-control')).toBe('no-store')
    expect(previewed.headers.get('cache-tag')).toBeNull()
    expect(previewed.headers.get('cloudflare-cdn-cache-control')).toBeNull()
    expect(previewed.headers.get('set-cookie')).toBeNull()
  })

  it('does not show the draft for a token that is expired, forged or for another entry, and clears the cookie only when Hollware says it is no good', async () => {
    const path = '/blog/markdown-as-source-of-truth/'
    const tokens = [
      await previewTokenFor(draftId, { ageSeconds: 3601 }),
      await previewTokenFor(draftId, { secret: 'x'.repeat(40) }),
      await previewTokenFor(publishedId),
      'hw_prv_nonsense',
    ]

    const answers = await Promise.all(
      tokens.map((token) => astroFetch(server, path, cookie(token))),
    )
    const bodies = await Promise.all(answers.map((answer) => answer.text()))

    expect(answers.map((answer) => answer.status)).toEqual([404, 404, 404, 404])
    expect(bodies.some((body) => body.includes('Markdown as the source of truth'))).toBe(false)
    expect(answers.map((answer) => answer.headers.get('set-cookie'))).toEqual([
      CLEARED,
      CLEARED,
      null,
      null,
    ])
    expect(answers.slice(0, 3).map((answer) => answer.headers.get('cache-control'))).toEqual([
      'no-store',
      'no-store',
      'no-store',
    ])
    expect(answers.map((answer) => answer.headers.get('cache-tag'))).toEqual([
      null,
      null,
      null,
      null,
    ])
  })

  it('never answers the published version in place of a token that does not hold', async () => {
    const path = '/blog/from-draft-to-published/'
    const token = await previewTokenFor(draftId)

    const answer = await astroFetch(server, path, cookie(token))

    expect(answer.status).toBe(404)
    expect(await answer.text()).not.toContain('From draft to published')
  })
})
