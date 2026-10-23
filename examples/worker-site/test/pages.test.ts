import { describe, expect, it } from 'vite-plus/test'

import { entryPage, escapeHtml, listingPage, messagePage, type Summary } from '../src/pages.ts'

const ENTRY: Summary = {
  href: '/blog/edge-caching/',
  title: 'Edge caching',
  description: 'What an edge cache keeps.',
  date: '2026-09-01',
  tags: ['cloudflare', 'cms'],
}

describe('escapeHtml', () => {
  it('escapes the five characters that matter, once', () => {
    expect(escapeHtml(`<a href="x" onclick='y'>&amp;</a>`)).toBe(
      '&lt;a href=&quot;x&quot; onclick=&#39;y&#39;&gt;&amp;amp;&lt;/a&gt;',
    )
  })

  it('leaves other text alone', () => {
    expect(escapeHtml('Cache en el borde: ñandú, 日本語 and emoji 🚀')).toBe(
      'Cache en el borde: ñandú, 日本語 and emoji 🚀',
    )
  })
})

describe('listingPage', () => {
  const page = listingPage({
    locale: 'es',
    tag: '',
    entries: [ENTRY],
    nextHref: null,
    alternates: [{ locale: 'en', href: '/en/blog/' }],
  })

  it('shows each entry with its link, description, date and tags', () => {
    expect(page).toContain('<html lang="es">')
    expect(page).toContain('<title>Blog</title>')
    expect(page).toContain('<h1>Blog</h1>')
    expect(page).toContain('<h2><a href="/blog/edge-caching/">Edge caching</a></h2>')
    expect(page).toContain('<p>What an edge cache keeps.</p>')
    expect(page).toContain(
      '<p><time datetime="2026-09-01">2026-09-01</time> · <a href="/blog/?tag=cloudflare">cloudflare</a> <a href="/blog/?tag=cms">cms</a></p>',
    )
  })

  it('links the other locale, in the head and in the navigation', () => {
    expect(page).toContain('<link rel="alternate" hreflang="en" href="/en/blog/">')
    expect(page).toContain('<a href="/blog/" lang="es" aria-current="page">Español</a>')
    expect(page).toContain('<a href="/en/blog/" lang="en" hreflang="en">English</a>')
  })

  it('has no link to a next page when there is none', () => {
    expect(page).not.toContain('rel="next"')
  })

  it('links the next page, with the address escaped for an attribute', () => {
    const paged = listingPage({
      locale: 'en',
      tag: 'cms',
      entries: [ENTRY],
      nextHref: '/en/blog/?tag=cms&cursor=abc',
      alternates: [],
    })

    expect(paged).toContain('<a rel="next" href="/en/blog/?tag=cms&amp;cursor=abc">Older posts</a>')
  })

  it('names the tag it is filtered by', () => {
    const tagged = listingPage({
      locale: 'en',
      tag: 'cms',
      entries: [],
      nextHref: null,
      alternates: [],
    })

    expect(tagged).toContain('<title>Blog: cms</title>')
    expect(tagged).toContain('<h1>Blog: cms</h1>')
    expect(tagged).toContain('<p>Nothing is published here yet.</p>')
  })

  it('escapes what authors wrote, and encodes the tag it links', () => {
    const hostile = listingPage({
      locale: 'en',
      tag: '<i>x</i>',
      entries: [
        {
          href: '/en/blog/x/',
          title: '<script>alert(1)</script>',
          description: 'a "quoted" & <b>bold</b> text',
          date: '<soon>',
          tags: ['a b&c'],
        },
      ],
      nextHref: null,
      alternates: [],
    })

    expect(hostile).toContain('<h1>Blog: &lt;i&gt;x&lt;/i&gt;</h1>')
    expect(hostile).toContain(
      '<h2><a href="/en/blog/x/">&lt;script&gt;alert(1)&lt;/script&gt;</a></h2>',
    )
    expect(hostile).toContain('<p>a &quot;quoted&quot; &amp; &lt;b&gt;bold&lt;/b&gt; text</p>')
    expect(hostile).toContain('<p>&lt;soon&gt; · <a href="/en/blog/?tag=a+b%26c">a b&amp;c</a></p>')
    expect(hostile).not.toContain('<script>')
  })
})

describe('entryPage', () => {
  const page = entryPage({
    locale: 'en',
    title: 'Edge "caching"',
    description: 'What <b>an</b> edge cache keeps.',
    body: '<h1 id="x">Edge</h1>\n<p>Some <em>text</em>.</p>',
    translations: [{ locale: 'es', href: '/blog/cache-en-el-borde/' }],
  })

  it('prints the body as it is, and escapes the title and the description', () => {
    expect(page).toContain('<title>Edge &quot;caching&quot;</title>')
    expect(page).toContain(
      '<meta name="description" content="What &lt;b&gt;an&lt;/b&gt; edge cache keeps.">',
    )
    expect(page).toContain(
      '<article>\n<h1 id="x">Edge</h1>\n<p>Some <em>text</em>.</p>\n</article>',
    )
  })

  it('links its translations in the head and below the article', () => {
    expect(page).toContain('<link rel="alternate" hreflang="es" href="/blog/cache-en-el-borde/">')
    expect(page).toContain(
      '<nav aria-label="Translations">\n<a href="/blog/cache-en-el-borde/" lang="es" hreflang="es">Español</a>\n</nav>',
    )
  })

  it('has no translations nav when it has none', () => {
    const alone = entryPage({
      locale: 'en',
      title: 'T',
      description: 'D',
      body: '<p>x</p>',
      translations: [],
    })

    expect(alone).not.toContain('Translations')
    expect(alone).not.toContain('rel="alternate"')
  })
})

describe('messagePage', () => {
  it('says what happened, and keeps the navigation', () => {
    const page = messagePage('es', 'Not found', 'There is <nothing> here.')

    expect(page).toContain('<html lang="es">')
    expect(page).toContain('<title>Not found</title>')
    expect(page).toContain('<h1>Not found</h1>\n<p>There is &lt;nothing&gt; here.</p>')
    expect(page).toContain('<a href="/en/blog/" lang="en" hreflang="en">English</a>')
  })
})
