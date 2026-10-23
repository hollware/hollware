import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { describe, expect, it } from 'vite-plus/test'

import { corpusFromNuxtContent } from '../src/import/from-nuxt-content.ts'

function content(files: Record<string, string>): string {
  const root = mkdtempSync(join(tmpdir(), 'nuxt-content-'))
  for (const [path, text] of Object.entries(files)) {
    mkdirSync(dirname(join(root, path)), { recursive: true })
    writeFileSync(join(root, path), text)
  }
  return root
}

describe('a Nuxt Content directory', () => {
  it('routes each page to its slug and keeps its Markdown as it is', () => {
    const page = '---\ntitle: Install\n---\n\n::callout{type="tip"}\nRun it.\n::\n'
    const root = content({
      '1.guide/2.install.md': page,
      '1.guide/index.md': '# Guide\n',
      'index.md': '# Home\n',
      '_partial.md': 'not a page',
      '.navigation.yml': 'title: Docs',
      'authors.yml': 'name: Ada',
    })

    const corpus = corpusFromNuxtContent(root, {
      collection: 'docs',
      locale: 'en',
      localeDirs: false,
      groupField: 'translationGroup',
    })

    expect(corpus.files.map(({ path, slug, markdown }) => ({ path, slug, markdown }))).toEqual([
      { path: 'docs/en/guide-install.md', slug: 'guide-install', markdown: page },
      {
        path: 'docs/en/guide.md',
        slug: 'guide',
        markdown: '---\ntitle: "Guide"\n---\n\n# Guide\n',
      },
      { path: 'docs/en/index.md', slug: 'index', markdown: '---\ntitle: "Home"\n---\n\n# Home\n' },
    ])
    expect(corpus.skipped).toEqual(['authors.yml'])
    expect(corpus.problems).toEqual([])
  })

  it('takes the locale from the first folder, and ties the pages at one path in a group', () => {
    const root = content({
      'en/blog/edge.md': '---\ntitle: Edge\n---\n\nText.\n',
      'es/blog/edge.md': '# Borde\n',
      'en/blog/grouped.md': '---\ntranslationGroup: kept\n---\n',
      'README.md': 'not in a locale',
    })

    const corpus = corpusFromNuxtContent(root, {
      collection: 'blog',
      locale: 'en',
      localeDirs: true,
      groupField: 'translationGroup',
    })

    expect(corpus.files.map(({ path, markdown }) => ({ path, markdown }))).toEqual([
      {
        path: 'blog/en/blog-edge.md',
        markdown: '---\ntitle: Edge\ntranslationGroup: "blog-edge"\n---\n\nText.\n',
      },
      {
        path: 'blog/en/blog-grouped.md',
        markdown: '---\ntranslationGroup: kept\ntitle: "blog-grouped"\n---\n',
      },
      {
        path: 'blog/es/blog-edge.md',
        markdown: '---\ntitle: "Borde"\ntranslationGroup: "blog-edge"\n---\n\n# Borde\n',
      },
    ])
    expect(corpus.skipped).toEqual(['README.md'])
  })

  it('reports a route that is no slug, and two pages that would share one', () => {
    const root = content({ 'Guide.md': '# A\n', 'a/b-c.md': '# B\n', 'a-b/c.md': '# C\n' })

    const corpus = corpusFromNuxtContent(root, {
      collection: 'docs',
      locale: 'en',
      localeDirs: false,
      groupField: 'translationGroup',
    })

    expect(corpus.files.map((file) => file.slug)).toEqual(['a-b-c'])
    expect(corpus.problems).toEqual([
      { path: 'Guide.md', reason: 'its route makes "Guide", which is not a slug' },
      { path: 'a-b/c.md', reason: 'its slug "a-b-c" is the slug of a/b-c.md too' },
    ])
  })
})
