import { describe, expect, it } from 'vite-plus/test'

import { BLOG_CORPUS, CONTENT_FIXTURES, contentFixture } from '../../../tests/fixtures/content.ts'

// Fails when: the fixture loader stops finding the Markdown of tests/fixtures/content in Node or
// in workerd, loses bytes on the way (the byte order mark), or the corpus stops being ten entries
// in five translation groups with one entry per locale.

describe('the content fixtures', () => {
  it('load every file, in Node and in workerd', () => {
    expect(CONTENT_FIXTURES.map((fixture) => fixture.path)).toEqual([
      'bench/long-post.md',
      'blog/en/agents-write-with-contracts.md',
      'blog/en/edge-caching-basics.md',
      'blog/en/from-draft-to-published.md',
      'blog/en/markdown-as-source-of-truth.md',
      'blog/en/one-deployment-many-sites.md',
      'blog/es/agentes-que-escriben-con-contratos.md',
      'blog/es/cache-en-el-borde.md',
      'blog/es/del-borrador-a-publicado.md',
      'blog/es/markdown-como-fuente-de-verdad.md',
      'blog/es/un-despliegue-muchos-sitios.md',
      'hostile/block-html.md',
      'hostile/bom.md',
      'hostile/broken-frontmatter.md',
      'hostile/disallowed-attribute.md',
      'hostile/nested-emphasis.md',
      'hostile/raw-html.md',
      'hostile/unknown-component.md',
      'hostile/unsafe-url.md',
      'invalid/broken-internal-link.md',
      'invalid/description-too-long.md',
      'invalid/image-without-alt.md',
      'invalid/missing-translation.md',
      'invalid/seo-title-too-long.md',
    ])
  })

  it('keep the bytes of a file, the byte order mark included', () => {
    expect(contentFixture('hostile/bom.md').charCodeAt(0)).toBe(0xfeff)
    expect(
      contentFixture('blog/es/cache-en-el-borde.md').startsWith('---\ntitle: Cache en el borde\n'),
    ).toBe(true)
    expect(contentFixture('hostile/nested-emphasis.md')).toContain('*a '.repeat(5000))
  })

  it('name the fixtures there are when asked for one that is not', () => {
    expect(() => contentFixture('blog/en/missing.md')).toThrow(
      /^no content fixture at blog\/en\/missing\.md; there are: bench\/long-post\.md, /,
    )
  })

  it('hold a corpus of ten entries in five translation groups, one per locale', () => {
    const groups = new Map<string, string[]>()
    for (const entry of BLOG_CORPUS) {
      const group = /\ntranslationGroup: ([a-z-]+)\n/.exec(entry.markdown)?.[1] ?? 'none'
      groups.set(group, [...(groups.get(group) ?? []), entry.locale].sort())
    }
    expect(Object.fromEntries(groups)).toEqual({
      'agents-and-contracts': ['en', 'es'],
      'edge-caching': ['en', 'es'],
      'markdown-source': ['en', 'es'],
      'publishing-flow': ['en', 'es'],
      'site-isolation': ['en', 'es'],
    })
  })
})
