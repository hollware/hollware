import type { HollwareRpc } from '@hollware/server'
import { afterAll, beforeAll, describe, expect, it } from 'vite-plus/test'

import { contentFixture } from '../../../../tests/fixtures/content.ts'
import {
  agentWith,
  createDraft,
  migrate,
  publishNew,
  seedOwnerToken,
  SITE_KEY,
  type Agent,
  type Draft,
} from './support.ts'
import { createPlaygroundHarness, SITE_URL, SITE_WORKER, siteFetch } from './workers.ts'

const server = createPlaygroundHarness()
let agent: Agent

const english = (slug: string): Draft => ({
  locale: 'en',
  slug,
  markdown: contentFixture(`blog/en/${slug}.md`),
})
const spanish = (slug: string): Draft => ({
  locale: 'es',
  slug,
  markdown: contentFixture(`blog/es/${slug}.md`),
})

function post(title: string, tag: string, group: string): string {
  return `---
title: ${title}
description: A post that a test writes.
date: 2026-01-01
tags:
  - ${tag}
translationGroup: ${group}
---

# Heading

Some text.
`
}

async function page(path: string, init?: Parameters<typeof siteFetch>[2]) {
  const response = await siteFetch(server, path, init)
  return { response, html: await response.text() }
}

function listed(html: string): string[] {
  return [...html.matchAll(/<h2><a href="([^"]+)">/g)].map((match) => match[1] ?? '')
}

function nextPage(html: string): string | null {
  const match = /<a rel="next" href="([^"]+)">/.exec(html)
  return match?.[1] === undefined ? null : match[1].replaceAll('&amp;', '&')
}

beforeAll(async () => {
  await server.listen()
  await migrate(server)
  agent = agentWith(server, await seedOwnerToken(server))
  for (const slug of [
    'from-draft-to-published',
    'one-deployment-many-sites',
    'agents-write-with-contracts',
    'edge-caching-basics',
  ]) {
    await publishNew(agent, english(slug))
  }
  await publishNew(agent, spanish('cache-en-el-borde'))
  await createDraft(agent, english('markdown-as-source-of-truth'))
})

afterAll(async () => {
  await server.close()
})

describe('an entry', () => {
  it('is served as the HTML of its stored document', async () => {
    const { response, html } = await page('/en/blog/edge-caching-basics/')

    expect(response.status).toBe(200)
    expect(html).toContain('<html lang="en">')
    expect(html).toContain('<title>Edge caching basics</title>')
    expect(html).toContain(
      '<meta name="description" content="What an edge cache keeps, for how long, and how a publish clears it.">',
    )
    expect(html).toContain('<h1 id="edge-caching-basics">Edge caching basics</h1>')
    expect(html).toContain(
      '<p>A site that publishes often needs <strong>fast reads</strong> and <em>predictable</em> writes. Read <a href="/en/blog/agents-write-with-contracts/">the post about agents write with contracts</a> for the related part of the story.</p>',
    )
    expect(html).toContain('<callout type="tip">')
    expect(html).toContain(
      '<pre data-language="ts"><code class="language-ts">const verdict = await validate(markdown)</code></pre>',
    )
    expect(html).toContain(
      '<img src="/images/edge-caching-basics.png" alt="A diagram of the flow">',
    )
  })

  it('answers as an HTML page that may load nothing but itself', async () => {
    const { response } = await page('/en/blog/edge-caching-basics/')

    expect(response.headers.get('content-type')).toBe('text/html; charset=utf-8')
    expect(response.headers.get('x-content-type-options')).toBe('nosniff')
    expect(response.headers.get('content-security-policy')).toBe(
      "default-src 'none'; img-src 'self' https:; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
    )
  })

  it('is a 404 when it is a draft, and when it never existed', async () => {
    const draft = await page('/en/blog/markdown-as-source-of-truth/')
    const missing = await page('/en/blog/never-written/')
    const wrongLocale = await page('/blog/edge-caching-basics/')

    expect(draft.response.status).toBe(404)
    expect(missing.response.status).toBe(404)
    expect(wrongLocale.response.status).toBe(404)
    expect(draft.html).toContain('<h1>Not found</h1>')
    expect(draft.html).not.toContain('Markdown as the source of truth')
  })

  it('links the translations that are published, and no others', async () => {
    const english = await page('/en/blog/edge-caching-basics/')
    const spanish = await page('/blog/cache-en-el-borde/')
    const alone = await page('/en/blog/agents-write-with-contracts/')

    expect(english.html).toContain(
      '<link rel="alternate" hreflang="es" href="/blog/cache-en-el-borde/">',
    )
    expect(english.html).toContain(
      '<a href="/blog/cache-en-el-borde/" lang="es" hreflang="es">Español</a>',
    )
    expect(spanish.html).toContain('<html lang="es">')
    expect(spanish.html).toContain(
      '<link rel="alternate" hreflang="en" href="/en/blog/edge-caching-basics/">',
    )
    expect(spanish.html).toContain(
      '<a href="/en/blog/edge-caching-basics/" lang="en" hreflang="en">English</a>',
    )
    expect(alone.html).not.toContain('rel="alternate"')
    expect(alone.html).not.toContain('Translations')
  })

  it('has its translation group answered as the ES/EN pair by the binding', async () => {
    const { HOLLWARE } = await server.getWorker<{ HOLLWARE: HollwareRpc }>(SITE_WORKER).getEnv()

    const answer = await HOLLWARE.getTranslations(SITE_KEY, 'blog', 'edge-caching')

    expect(answer.outcome).toBe('ok')
    expect((answer.entries ?? []).map((entry) => `${entry.locale}/${entry.slug}`).sort()).toEqual([
      'en/edge-caching-basics',
      'es/cache-en-el-borde',
    ])
  })

  it('is a 404 once it is unpublished', async () => {
    const id = await publishNew(agent, {
      locale: 'en',
      slug: 'short-lived',
      markdown: post('Short lived', 'short-lived', 'short-lived'),
    })
    expect((await page('/en/blog/short-lived/')).response.status).toBe(200)
    expect(listed((await page('/en/blog/?tag=short-lived')).html)).toEqual([
      '/en/blog/short-lived/',
    ])

    const answer = await agent.call('unpublish', { id })

    expect(answer.output['outcome']).toBe('unpublished')
    expect((await page('/en/blog/short-lived/')).response.status).toBe(404)
    expect(listed((await page('/en/blog/?tag=short-lived')).html)).toEqual([])
  })
})

describe('the blog index', () => {
  it('lists the published entries of a locale, newest first, and not the draft', async () => {
    const { response, html } = await page('/en/blog/')

    expect(response.status).toBe(200)
    expect(listed(html)).toEqual([
      '/en/blog/from-draft-to-published/',
      '/en/blog/one-deployment-many-sites/',
    ])
    expect(html).toContain('<h1>Blog</h1>')
    expect(html).toContain('<time datetime="2026-09-29">2026-09-29</time>')
    expect(html).toContain(
      '<p>The steps between a saved draft and a page that readers can open.</p>',
    )
  })

  it('lists only the locale it was asked for', async () => {
    const { html } = await page('/blog/')

    expect(listed(html)).toEqual(['/blog/cache-en-el-borde/'])
  })

  it('filters by tag and takes a cursor from one page to the next', async () => {
    const first = await page('/en/blog/?tag=cms')
    const nextAddress = nextPage(first.html)

    expect(listed(first.html)).toEqual([
      '/en/blog/one-deployment-many-sites/',
      '/en/blog/agents-write-with-contracts/',
    ])
    expect(first.html).toContain('<h1>Blog: cms</h1>')
    expect(nextAddress).toMatch(/^\/en\/blog\/\?tag=cms&cursor=\S+$/)

    const second = await page(nextAddress ?? '')

    expect(listed(second.html)).toEqual(['/en/blog/edge-caching-basics/'])
    expect(nextPage(second.html)).toBeNull()
  })

  it('shows an empty page for a tag nobody used', async () => {
    const { response, html } = await page('/en/blog/?tag=nobody-used-this')

    expect(response.status).toBe(200)
    expect(listed(html)).toEqual([])
    expect(html).toContain('<p>Nothing is published here yet.</p>')
  })

  it('links the index of the other locale', async () => {
    const { html } = await page('/en/blog/')

    expect(html).toContain('<link rel="alternate" hreflang="es" href="/blog/">')
  })
})

describe('what authors write', () => {
  it('is escaped in the listing, in the page and in its title', async () => {
    await publishNew(agent, {
      locale: 'en',
      slug: 'escape-test',
      markdown: `---
title: '<b>Bold</b> & "quoted"'
description: 'It says <script>alert(1)</script> here.'
date: 2026-01-01
tags:
  - 'x"y'
translationGroup: escape-test
---

# Heading

Some text.
`,
    })

    const index = await page(`/en/blog/?${new URLSearchParams({ tag: 'x"y' }).toString()}`)
    const entry = await page('/en/blog/escape-test/')

    expect(index.html).toContain(
      '<h2><a href="/en/blog/escape-test/">&lt;b&gt;Bold&lt;/b&gt; &amp; &quot;quoted&quot;</a></h2>',
    )
    expect(index.html).toContain('<p>It says &lt;script&gt;alert(1)&lt;/script&gt; here.</p>')
    expect(index.html).toContain('<a href="/en/blog/?tag=x%22y">x&quot;y</a>')
    expect(entry.html).toContain('<title>&lt;b&gt;Bold&lt;/b&gt; &amp; &quot;quoted&quot;</title>')
    expect(entry.html).toContain(
      '<meta name="description" content="It says &lt;script&gt;alert(1)&lt;/script&gt; here.">',
    )
    expect(`${index.html}${entry.html}`).not.toContain('<script>')
  })
})

describe('an address', () => {
  it('without its trailing slash is redirected to the one with it, keeping the query', async () => {
    const blog = await page('/blog', { redirect: 'manual' })
    const entry = await page('/en/blog/edge-caching-basics?utm=a', { redirect: 'manual' })

    expect(blog.response.status).toBe(301)
    expect(blog.response.headers.get('location')).toBe(`${SITE_URL}/blog/`)
    expect(entry.response.status).toBe(301)
    expect(entry.response.headers.get('location')).toBe(
      `${SITE_URL}/en/blog/edge-caching-basics/?utm=a`,
    )
  })

  it.each(['/', '/about/', '/blog/Not-A-Slug/', '/blog/a/b/', '/en/blog//'])(
    'that this site does not serve is a 404: %s',
    async (path) => {
      expect((await page(path)).response.status).toBe(404)
    },
  )

  it('is answered to GET and HEAD only', async () => {
    const post = await page('/blog/', { method: 'POST' })

    expect(post.response.status).toBe(405)
    expect(post.response.headers.get('allow')).toBe('GET, HEAD')
    expect((await page('/blog/', { method: 'HEAD' })).response.status).toBe(200)
  })
})
