import { readdirSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
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
import { createReactRouterHarness, reactRouterFetch } from './workers.ts'

// Fails when: @hollware/react (packages/react) stops letting a React Router site on Cloudflare
// read Hollware over its service binding at request time: the page of a published entry rendered
// on the server by <HollwareContent> from its Comark document, a component of the entry
// (`::callout`) drawn by the site's own React component, the index from `listEntries`; or it serves
// a draft, or an entry that does not exist, as anything but a 404 (but for a preview token of that
// entry, which serves its latest revision with `no-store`, T-103; a token that is expired, forged
// or for another entry serves nothing), or lists a draft; or the browser's bundle takes in
// Hollware's server helpers. The site is examples/react-router-blog, built by React Router with
// @cloudflare/vite-plugin and no Node.js compatibility; content is published through MCP, as an
// agent does.

const MANUAL = { redirect: 'manual' } as const
const CLEARED = 'hollware_preview=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0'

/** A request of a visitor whose browser holds the preview cookie. */
function cookie(token: string) {
  return { headers: { cookie: `hollware_preview=${token}` } }
}

let draftId = ''
let publishedId = ''

const server = createReactRouterHarness()

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

describe('a React Router site with @hollware/react', () => {
  it('renders a published entry on the server from its document, a component as the site draws it', async () => {
    const page = await reactRouterFetch(server, '/blog/from-draft-to-published')
    const html = await page.text()

    expect(page.status).toBe(200)
    expect(html).toContain('<title>From draft to published</title>')
    expect(html).toContain('<meta name="generator" content="Hollware"/>')
    expect(html).toMatch(/<h1[^>]*>From draft to published<\/h1>/)
    expect(html).toMatch(/<h2[^>]*>Why it matters<\/h2>/)
    // `::callout{type="tip"}` of the entry, as the site's Callout draws it.
    expect(html).toContain(
      '<aside class="callout callout-tip" data-callout="tip">Keep the slug short: it becomes part of the public path.</aside>',
    )
    // The browser hydrates from the same document and the scripts of the build.
    expect(html).toContain('<script type="module"')
    expect(page.headers.get('cache-control')).not.toBe('no-store')
  })

  it('lists the published entries, and not the draft', async () => {
    const html = await (await reactRouterFetch(server, '/')).text()

    expect(html).toContain('href="/blog/from-draft-to-published"')
    expect(html).toContain('From draft to published</a>')
    expect(html).not.toContain('markdown-as-source-of-truth')
  })

  it('answers a draft and an entry that does not exist with a 404', async () => {
    const draft = await reactRouterFetch(server, '/blog/markdown-as-source-of-truth')
    const missing = await reactRouterFetch(server, '/blog/never-written')

    expect([draft.status, missing.status]).toEqual([404, 404])
    expect(await draft.text()).not.toContain('Markdown as the source of truth')
  })

  it('exchanges the preview link for a cookie and a redirect to the same URL without it', async () => {
    const path = '/blog/markdown-as-source-of-truth'
    const token = await previewTokenFor(draftId)

    const answer = await reactRouterFetch(
      server,
      `${path}?a=1&hollware-preview=${token}&b=2`,
      MANUAL,
    )

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
    const path = '/blog/markdown-as-source-of-truth'

    const answer = await reactRouterFetch(
      server,
      `${path}?hollware-preview=hw_prv_nonsense`,
      MANUAL,
    )

    expect(answer.status).toBe(303)
    expect(answer.headers.get('location')).toBe(path)
    expect(answer.headers.get('set-cookie')).toBeNull()
  })

  it('serves a draft with the cookie of that entry, and never keeps the page', async () => {
    const path = '/blog/markdown-as-source-of-truth'
    const token = await previewTokenFor(draftId)

    const without = await reactRouterFetch(server, path)
    const previewed = await reactRouterFetch(server, path, cookie(token))
    const html = await previewed.text()

    expect(without.status).toBe(404)
    expect(previewed.status).toBe(200)
    expect(html).toContain('<title>Markdown as the source of truth</title>')
    expect(previewed.headers.get('cache-control')).toBe('no-store')
    expect(previewed.headers.get('set-cookie')).toBeNull()
  })

  it('does not show the draft for a token that is expired, forged or for another entry, and clears the cookie only when Hollware says it is no good', async () => {
    const path = '/blog/markdown-as-source-of-truth'
    const tokens = [
      await previewTokenFor(draftId, { ageSeconds: 3601 }),
      await previewTokenFor(draftId, { secret: 'x'.repeat(40) }),
      await previewTokenFor(publishedId),
      'hw_prv_nonsense',
    ]

    const answers = await Promise.all(
      tokens.map((token) => reactRouterFetch(server, path, cookie(token))),
    )
    const bodies = await Promise.all(answers.map((answer) => answer.text()))

    expect(answers.map((answer) => answer.status)).toEqual([404, 404, 404, 404])
    expect(bodies.some((body) => body.includes('Markdown as the source of truth'))).toBe(false)
    // The expired and the forged token clear the cookie; the one of another entry, which Hollware
    // answers as no entry, and a value that is no token at all, change nothing.
    expect(answers.map((answer) => answer.headers.get('set-cookie'))).toEqual([
      CLEARED,
      CLEARED,
      null,
      null,
    ])
    // A token that is shaped like one is a preview, so nothing keeps the answer; a value that is
    // not is no preview at all.
    expect(answers.slice(0, 3).map((answer) => answer.headers.get('cache-control'))).toEqual([
      'no-store',
      'no-store',
      'no-store',
    ])
  })

  it('never answers the published version in place of a token that does not hold', async () => {
    const path = '/blog/from-draft-to-published'
    const token = await previewTokenFor(draftId)

    const answer = await reactRouterFetch(server, path, cookie(token))

    expect(answer.status).toBe(404)
    expect(await answer.text()).not.toContain('From draft to published')
  })

  it('keeps Hollware’s server helpers out of the browser bundle', () => {
    const directory = fileURLToPath(
      new URL('../../../../examples/react-router-blog/build/client/assets/', import.meta.url),
    )
    const files = readdirSync(directory).filter((file) => file.endsWith('.js'))
    const bundle = files.map((file) => readFileSync(`${directory}${file}`, 'utf8')).join('\n')

    expect(files.length).toBeGreaterThan(0)
    // The refusal code and the cookie of a preview, and zod, live in the server's helpers only.
    expect(
      ['invalid_preview', 'hollware_preview', 'ZodError'].filter((s) => bundle.includes(s)),
    ).toEqual([])
  })
})
