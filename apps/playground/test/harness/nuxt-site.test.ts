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
import {
  createNuxtHarness,
  NUXT_HOLLWARE_WEBHOOK_SECRET,
  NUXT_WORKER,
  nuxtFetch,
  SITE_URL,
} from './workers.ts'
import { EVENT_ID_HEADER, SIGNATURE_HEADER, signWebhook, TIMESTAMP_HEADER } from '@hollware/core'

const MANUAL = { redirect: 'manual' } as const
const CLEARED = 'hollware_preview=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0'

function cookie(token: string) {
  return { headers: { cookie: `hollware_preview=${token}` } }
}

let draftId = ''
let publishedId = ''

const server = createNuxtHarness()

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

describe('a Nuxt site with @hollware/nuxt', () => {
  it('renders a published entry on the server, from its Comark document', async () => {
    const page = await nuxtFetch(server, '/en/blog/from-draft-to-published/')
    const html = await page.text()

    expect(page.status).toBe(200)
    expect(html).toContain('<title>From draft to published</title>')
    expect(html).toContain(
      '<meta name="description" content="The steps between a saved draft and a page that readers can open.">',
    )
    expect(html).toMatch(/<h1[^>]*>From draft to published<\/h1>/)
    expect(html).toMatch(/<h1 id="from-draft-to-published"[^>]*>From draft to published<\/h1>/)
    expect(html).toContain('<meta name="generator" content="Hollware">')
    expect(html).not.toContain('contractsHash')
    expect(html).not.toContain('lastPublication')
  })

  it('lists the published entries, and not the draft', async () => {
    const html = await (await nuxtFetch(server, '/en/')).text()

    expect(html).toMatch(/<html[^>]* lang="en"/)
    expect(html).toContain('<title>Blog · Hollware demo</title>')
    expect(html).toContain(
      '<meta name="description" content="This blog is a Nuxt site that reads Hollware over a service binding.',
    )
    expect(html).toContain('href="/en/blog/from-draft-to-published/"')
    expect(html).not.toContain('markdown-as-source-of-truth')
  })

  it('hands the browser nothing of the server: no binding, no token, no Hollware config', async () => {
    const html = await (await nuxtFetch(server, '/en/')).text()

    expect(html).not.toContain('binding:')
    expect(html).not.toContain('hollware:{')
  })

  it('tags each page with what it showed for the edge to keep, and never an error', async () => {
    const page = await nuxtFetch(server, '/en/')
    const route = await nuxtFetch(server, '/_hollware/entries/blog?locale=en')
    const missing = await nuxtFetch(server, '/en/blog/never-written/')

    const tags = (page.headers.get('cache-tag') ?? '').split(',')
    expect(tags).toContain('list:blog:en')
    expect(tags.filter((tag) => tag.startsWith('entry:ent_')).length).toBeGreaterThan(0)
    expect(page.headers.get('cloudflare-cdn-cache-control')).toBe('max-age=31536000')
    expect(page.headers.get('cache-control')).toBe('public, max-age=0, must-revalidate')
    expect((route.headers.get('cache-tag') ?? '').split(',')).toContain('list:blog:en')
    expect(missing.headers.get('cache-tag')).toBeNull()
  })

  it('takes a signed event of its site to purge, and refuses a bad signature or another site', async () => {
    const body = JSON.stringify({ id: 'evt_1', site: 'playground', cacheTags: ['list:blog:en'] })
    const send = async (secret: string, payload = body) => {
      const timestamp = Math.floor(Date.now() / 1000)
      return server.getWorker(NUXT_WORKER).fetch(`${SITE_URL}/_hollware/webhook`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          [EVENT_ID_HEADER]: 'evt_1',
          [TIMESTAMP_HEADER]: String(timestamp),
          [SIGNATURE_HEADER]: await signWebhook(secret, timestamp, payload),
        },
        body: payload,
      })
    }

    const forged = await send(`whsec_${'6'.repeat(64)}`)
    const elsewhere = await send(
      NUXT_HOLLWARE_WEBHOOK_SECRET,
      JSON.stringify({ id: 'evt_2', site: 'docs', cacheTags: ['list:blog:en'] }),
    )
    const signed = await send(NUXT_HOLLWARE_WEBHOOK_SECRET)

    expect([forged.status, elsewhere.status]).toEqual([401, 401])
    expect([200, 501]).toContain(signed.status)
  })

  it('answers a draft and an entry that does not exist with a 404', async () => {
    const draft = await nuxtFetch(server, '/en/blog/markdown-as-source-of-truth/')
    const missing = await nuxtFetch(server, '/_hollware/entry/blog/en/never-written')

    expect([draft.status, missing.status]).toEqual([404, 404])
  })

  it('exchanges the preview link for a cookie and a redirect to the same URL without it', async () => {
    const path = '/en/blog/markdown-as-source-of-truth/'
    const token = await previewTokenFor(draftId)

    const answer = await nuxtFetch(server, `${path}?a=1&hollware-preview=${token}&b=2`, MANUAL)

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
    const path = '/en/blog/markdown-as-source-of-truth/'

    const answer = await nuxtFetch(server, `${path}?hollware-preview=hw_prv_nonsense`, MANUAL)

    expect(answer.status).toBe(303)
    expect(answer.headers.get('location')).toBe(path)
    expect(answer.headers.get('set-cookie')).toBeNull()
  })

  it('serves a draft with the cookie of that entry, and never keeps the page', async () => {
    const path = '/en/blog/markdown-as-source-of-truth/'
    const token = await previewTokenFor(draftId)

    const without = await nuxtFetch(server, path)
    const previewed = await nuxtFetch(server, path, cookie(token))
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
    const path = '/en/blog/markdown-as-source-of-truth/'
    const tokens = [
      await previewTokenFor(draftId, { ageSeconds: 3601 }),
      await previewTokenFor(draftId, { secret: 'x'.repeat(40) }),
      await previewTokenFor(publishedId),
      'hw_prv_nonsense',
    ]

    const answers = await Promise.all(tokens.map((token) => nuxtFetch(server, path, cookie(token))))
    const bodies = await Promise.all(answers.map((answer) => answer.text()))

    expect(answers.map((answer) => answer.status)).toEqual([404, 404, 404, 404])
    expect(bodies.some((body) => body.includes('Markdown as the source of truth'))).toBe(false)
    expect(answers.map((answer) => answer.headers.get('set-cookie'))).toEqual([
      CLEARED,
      CLEARED,
      null,
      null,
    ])
    expect(answers.map((answer) => answer.headers.get('cache-tag'))).toEqual([
      null,
      null,
      null,
      null,
    ])
  })

  it('never answers the published version in place of a token that does not hold', async () => {
    const path = '/en/blog/from-draft-to-published/'
    const token = await previewTokenFor(draftId)

    const answer = await nuxtFetch(server, path, cookie(token))

    expect(answer.status).toBe(404)
    expect(await answer.text()).not.toContain('From draft to published')
  })
})
