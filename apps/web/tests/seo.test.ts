import { describe, expect, it } from 'vite-plus/test'

import {
  breadcrumbs,
  faqPage,
  imageOf,
  jsonLdOf,
  linksOf,
  robotsOf,
  sitemapOf,
} from '../app/utils/seo.ts'

describe('the head of a page', () => {
  it('has an absolute canonical, both languages and its Markdown when it is translated', () => {
    expect(
      linksOf({
        path: '/features/agents/',
        alternates: { en: '/features/agents/', es: '/es/features/agents/' },
        markdown: '/features/agents.md',
      }),
    ).toEqual([
      { rel: 'canonical', href: 'https://hollware.com/features/agents/' },
      { rel: 'alternate', hreflang: 'en', href: 'https://hollware.com/features/agents/' },
      { rel: 'alternate', hreflang: 'es', href: 'https://hollware.com/es/features/agents/' },
      { rel: 'alternate', hreflang: 'x-default', href: 'https://hollware.com/features/agents/' },
      { rel: 'alternate', type: 'text/markdown', href: '/features/agents.md' },
    ])
  })

  it('names no other language for a page that has no translation', () => {
    expect(linksOf({ path: '/compare/wordpress/', alternates: null })).toEqual([
      { rel: 'canonical', href: 'https://hollware.com/compare/wordpress/' },
    ])
  })

  it('keeps a page out of search only when it asks, and gives an absolute image', () => {
    expect(robotsOf({ path: '/media-kit/', noindex: true })).toBe('noindex, follow')
    expect(robotsOf({ path: '/install/' })).toBeUndefined()
    expect(imageOf({ path: '/' })).toBe('https://hollware.com/og.png')
    expect(imageOf({ path: '/', image: 'https://cms.example.com/assets/docs/ast_1' })).toBe(
      'https://cms.example.com/assets/docs/ast_1',
    )
  })
})

describe('structured data', () => {
  it('makes a FAQPage only of questions, and breadcrumbs numbered from 1', () => {
    expect(faqPage([])).toBeNull()
    expect(faqPage([{ question: 'Is it MIT?', answer: 'Yes.' }])).toEqual({
      '@type': 'FAQPage',
      mainEntity: [
        {
          '@type': 'Question',
          name: 'Is it MIT?',
          acceptedAnswer: { '@type': 'Answer', text: 'Yes.' },
        },
      ],
    })
    expect(
      breadcrumbs([
        { name: 'Home', path: '/' },
        { name: 'Glossary', path: '/glossary/' },
      ]),
    ).toEqual({
      '@type': 'BreadcrumbList',
      itemListElement: [
        { '@type': 'ListItem', position: 1, name: 'Home', item: 'https://hollware.com/' },
        {
          '@type': 'ListItem',
          position: 2,
          name: 'Glossary',
          item: 'https://hollware.com/glossary/',
        },
      ],
    })
  })

  it('writes one graph a script cannot end early, without the nodes that are null', () => {
    const text = jsonLdOf([{ '@type': 'Thing', name: '</script><b>' }, null])
    expect(text).toBe(
      '{"@context":"https://schema.org","@graph":[{"@type":"Thing","name":"\\u003c/script>\\u003cb>"}]}',
    )
    expect(JSON.parse(text)['@graph'][0].name).toBe('</script><b>')
  })
})

describe('the sitemap', () => {
  it('lists each URL with its day and the other language of each, escaped', () => {
    expect(
      sitemapOf([
        {
          path: '/features/',
          modified: '2026-11-02T21:00:00.000Z',
          alternates: { en: '/features/', es: '/es/features/' },
        },
        { path: '/a&b/' },
      ]),
    ).toBe(
      [
        '<?xml version="1.0" encoding="UTF-8"?>',
        '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">',
        '  <url>',
        '    <loc>https://hollware.com/features/</loc>',
        '    <lastmod>2026-11-02</lastmod>',
        '    <xhtml:link rel="alternate" hreflang="en" href="https://hollware.com/features/"/>',
        '    <xhtml:link rel="alternate" hreflang="es" href="https://hollware.com/es/features/"/>',
        '    <xhtml:link rel="alternate" hreflang="x-default" href="https://hollware.com/features/"/>',
        '  </url>',
        '  <url>',
        '    <loc>https://hollware.com/a&amp;b/</loc>',
        '  </url>',
        '</urlset>',
        '',
      ].join('\n'),
    )
  })
})
