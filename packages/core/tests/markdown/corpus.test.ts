import { describe, expect, it } from 'vite-plus/test'

import { BLOG_CORPUS, contentFixture } from '../../../../tests/fixtures/content.ts'
import { COMARK_VERSION, PIPELINE_VERSION } from '../../src/markdown/versions.ts'
import { accepted, warmUpComark } from './support.ts'

// Fails when: the pipeline stops accepting the playground's blog without a marker (an allowlist
// in src/markdown/policy.ts rejects an attribute, a tag or a URL that Markdown and Comark put on
// a plain post), or finds something other than what these posts hold: a heading (its depth, its
// text, its id, its line), a link and the entry it names, an image and its alt, a component and
// its props, the words, as src/markdown/analyze.ts reads them from the document. The word counts
// were made by hand, with `wc -w` on the text without its marks.

warmUpComark()

describe('the blog corpus', () => {
  /** Each entry, with the words of its body outside code blocks (counted by hand). */
  const WORDS: Record<string, number> = {
    'en/agents-write-with-contracts': 106,
    'en/edge-caching-basics': 100,
    'en/from-draft-to-published': 99,
    'en/markdown-as-source-of-truth': 105,
    'en/one-deployment-many-sites': 99,
    'es/agentes-que-escriben-con-contratos': 102,
    'es/cache-en-el-borde': 101,
    'es/del-borrador-a-publicado': 98,
    'es/markdown-como-fuente-de-verdad': 100,
    'es/un-despliegue-muchos-sitios': 97,
  }

  it('has ten entries, and every one parses without a marker', async () => {
    expect(BLOG_CORPUS).toHaveLength(10)
    for (const entry of BLOG_CORPUS) {
      const { extracted } = await accepted(entry.markdown)
      expect(extracted.disallowed, entry.slug).toStrictEqual([])
      expect(extracted.words, entry.slug).toBe(WORDS[`${entry.locale}/${entry.slug}`])
    }
  })

  it('has in every entry a title, two sections, one internal link, one image with alt and one callout', async () => {
    for (const entry of BLOG_CORPUS) {
      const { extracted } = await accepted(entry.markdown)
      expect(
        extracted.headings.map((heading) => heading.depth),
        entry.slug,
      ).toStrictEqual([1, 2, 2])
      expect(
        extracted.links.map((link) => link.kind),
        entry.slug,
      ).toStrictEqual(['internal'])
      expect(
        extracted.images.map((image) => image.alt !== ''),
        entry.slug,
      ).toStrictEqual([true])
      expect(extracted.components, entry.slug).toHaveLength(1)
      expect(extracted.components[0]?.name, entry.slug).toBe('callout')
      expect(extracted.components[0]?.props, entry.slug).toStrictEqual({ type: 'tip' })
    }
  })

  it('links every entry to an entry of the corpus, in its own language', async () => {
    const entries = new Set(BLOG_CORPUS.map((entry) => `blog/${entry.locale}/${entry.slug}`))
    for (const entry of BLOG_CORPUS) {
      const { extracted } = await accepted(entry.markdown)
      for (const link of extracted.links) {
        expect(link.target?.locale, entry.slug).toBe(entry.locale)
        expect(
          entries.has(`${link.target?.collection}/${link.target?.locale}/${link.target?.slug}`),
        ).toBe(true)
      }
    }
  })

  it('reads edge-caching-basics: headings, link, image, component, words', async () => {
    const result = await accepted(contentFixture('blog/en/edge-caching-basics.md'))
    expect(result.extracted).toStrictEqual({
      headings: [
        { depth: 1, text: 'Edge caching basics', id: 'edge-caching-basics', line: 11 },
        { depth: 2, text: 'Why it matters', id: 'why-it-matters', line: 15 },
        { depth: 2, text: 'How it works', id: 'how-it-works', line: 23 },
      ],
      links: [
        {
          href: '/en/blog/agents-write-with-contracts/',
          kind: 'internal',
          target: { collection: 'blog', locale: 'en', slug: 'agents-write-with-contracts' },
          line: 17,
        },
      ],
      images: [{ src: '/images/edge-caching-basics.png', alt: 'A diagram of the flow', line: 33 }],
      components: [{ name: 'callout', props: { type: 'tip' }, line: 19 }],
      words: 100,
      codeWords: 5,
      disallowed: [],
    })
    expect(result.frontmatter).toStrictEqual({
      title: 'Edge caching basics',
      description: 'What an edge cache keeps, for how long, and how a publish clears it.',
      date: '2026-09-01',
      tags: ['cloudflare', 'cms'],
      translationGroup: 'edge-caching',
    })
    expect(result.comarkVersion).toBe(COMARK_VERSION)
    expect(result.pipelineVersion).toBe(PIPELINE_VERSION)
  })

  it('reads cache-en-el-borde: the accents stay in the ids, and the link names a Spanish entry', async () => {
    const { extracted } = await accepted(contentFixture('blog/es/cache-en-el-borde.md'))
    expect(extracted).toStrictEqual({
      headings: [
        { depth: 1, text: 'Cache en el borde', id: 'cache-en-el-borde', line: 11 },
        { depth: 2, text: 'Por qué importa', id: 'por-qué-importa', line: 15 },
        { depth: 2, text: 'Cómo funciona', id: 'cómo-funciona', line: 23 },
      ],
      links: [
        {
          href: '/blog/agentes-que-escriben-con-contratos/',
          kind: 'internal',
          target: { collection: 'blog', locale: 'es', slug: 'agentes-que-escriben-con-contratos' },
          line: 17,
        },
      ],
      images: [{ src: '/images/cache-en-el-borde.png', alt: 'Un diagrama del flujo', line: 33 }],
      components: [{ name: 'callout', props: { type: 'tip' }, line: 19 }],
      words: 101,
      codeWords: 5,
      disallowed: [],
    })
  })

  it('keeps a code block with its language, and its words are not in the count', async () => {
    const { document } = await accepted(contentFixture('blog/en/edge-caching-basics.md'))
    const code = document.nodes.find((node) => Array.isArray(node) && node[0] === 'pre')
    expect(code).toStrictEqual([
      'pre',
      { language: 'ts' },
      ['code', { class: 'language-ts' }, 'const verdict = await validate(markdown)'],
    ])
  })
})

describe('the benchmark post', () => {
  it('has exactly 2,027 words, which is what tests/fixtures/README.md says and `wc -w` finds without the marks', async () => {
    const { extracted } = await accepted(contentFixture('bench/long-post.md'))
    expect(extracted.words).toBe(2027)
  })

  it('has its fourteen headings, twelve links and two callouts, on the lines they are on', async () => {
    const { extracted } = await accepted(contentFixture('bench/long-post.md'))
    expect(
      extracted.headings.map((heading) => [heading.depth, heading.id, heading.line]),
    ).toStrictEqual([
      [1, 'edge-caching-from-the-first-request-to-the-purge', 11],
      [2, 'part-1-what-the-edge-sees', 15],
      [2, 'part-2-what-the-reader-sees', 21],
      [2, 'part-3-what-the-writer-sees', 27],
      [2, 'part-4-what-the-origin-sees', 35],
      [2, 'part-5-what-the-edge-sees', 46],
      [2, 'part-6-what-the-reader-sees', 56],
      [2, 'part-7-what-the-writer-sees', 66],
      [2, 'part-8-what-the-origin-sees', 72],
      [2, 'part-9-what-the-edge-sees', 83],
      [2, 'part-10-what-the-reader-sees', 91],
      [2, 'part-11-what-the-writer-sees', 101],
      [2, 'part-12-what-the-origin-sees', 107],
      [2, 'closing', 122],
    ])
    expect(extracted.links.map((link) => link.line)).toStrictEqual([
      17, 23, 29, 37, 48, 58, 68, 74, 85, 93, 103, 109,
    ])
    expect(extracted.components).toStrictEqual([
      { name: 'callout', props: { type: 'info' }, line: 52 },
      { name: 'callout', props: { type: 'info' }, line: 97 },
    ])
    expect(extracted.disallowed).toStrictEqual([])
  })
})

describe('the invalid fixtures, which break rules of the contracts and not of content safety', () => {
  it('names the entry that a broken internal link points to, which is for a contract to look for', async () => {
    const { extracted } = await accepted(contentFixture('invalid/broken-internal-link.md'))
    expect(extracted.links).toStrictEqual([
      {
        href: '/en/blog/this-post-does-not-exist/',
        kind: 'internal',
        target: { collection: 'blog', locale: 'en', slug: 'this-post-does-not-exist' },
        line: 10,
      },
    ])
  })

  it('gives an image without alt text an alt of the empty string', async () => {
    const { extracted } = await accepted(contentFixture('invalid/image-without-alt.md'))
    expect(extracted.images).toStrictEqual([{ src: '/images/no-alt.png', alt: '', line: 10 }])
  })

  it('accepts the rest, with nothing to report', async () => {
    for (const path of [
      'invalid/description-too-long.md',
      'invalid/missing-translation.md',
      'invalid/seo-title-too-long.md',
    ]) {
      expect((await accepted(contentFixture(path))).extracted.disallowed, path).toStrictEqual([])
    }
  })
})
