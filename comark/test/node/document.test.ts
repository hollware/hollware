import { createRequire } from 'node:module'
import { gzipSync } from 'node:zlib'
import { renderHtmlFromDocument } from '@comark/html'
import { describe, expect, it } from 'vite-plus/test'
import { generatePost, SMALL_POST } from '../../src/fixtures.ts'
import { extract, NATIVE_TAGS, parseDocument } from '../../src/pipeline.ts'
import { SMALL_POST_HTML } from '../support/small-post.ts'

// S3d. Fails when: the document stops being plain JSON (a Date, undefined, a cycle), when rendering a
// revived document differs from rendering the fresh one, when extract() reads something different out
// of a revived document, when the size of the document relative to the Markdown changes, or when
// Comark starts exposing a version at runtime (then the pinned constant in src/versions.ts can go).

describe('the Comark document as a derived column', () => {
  it('is the tuple form [tag, props, ...children] next to frontmatter and meta', async () => {
    const document = await parseDocument('# Hi\n\nA [link](/a/) **b**')

    expect(JSON.stringify(document)).toBe(
      '{"frontmatter":{},"meta":{},"nodes":[["h1",{"id":"hi"},"Hi"],["p",{},"A ",["a",{"href":"/a/"},"link"]," ",["strong",{},"b"]]]}',
    )
    expect(Object.keys(document).sort()).toStrictEqual(['frontmatter', 'meta', 'nodes'])
  })

  it.each([
    // [label, words, markdown bytes, document JSON bytes, nodes-only JSON bytes, gzip(markdown), gzip(JSON)]
    ['the small post', 0, 1171, 1805, 1465, 643, 805],
    ['2,000 words', 2000, 13640, 17642, 17397, 2075, 2388],
    ['10,000 words', 10000, 68327, 87561, 87316, 4984, 7166],
  ])(
    '%s: sizes of the Markdown and of its document',
    async (_label, words, mdBytes, jsonBytes, nodesBytes, mdGzip, jsonGzip) => {
      const markdown = words === 0 ? SMALL_POST : generatePost(words)
      const document = await parseDocument(markdown)
      const json = JSON.stringify(document)

      expect(Buffer.byteLength(markdown)).toBe(mdBytes)
      expect(Buffer.byteLength(json)).toBe(jsonBytes)
      expect(Buffer.byteLength(JSON.stringify(document.nodes))).toBe(nodesBytes)
      expect(gzipSync(markdown, { level: 9 }).length).toBe(mdGzip)
      expect(gzipSync(json, { level: 9 }).length).toBe(jsonGzip)
    },
  )

  it('survives JSON.stringify and JSON.parse unchanged, comments and raw HTML markers included', async () => {
    const markdown = `${SMALL_POST}\n<!-- a comment -->\n\n<div class="x">raw **html**</div>\n`
    const document = await parseDocument(markdown)
    const revived = JSON.parse(JSON.stringify(document))

    expect(revived).toStrictEqual(document)
    expect(JSON.stringify(document)).toContain('[null,{}," a comment "]')
    expect(JSON.stringify(document)).toContain('"$":{"html":1,"block":1}')
  })

  it('renders to the exact HTML after the round trip, without parsing again', async () => {
    const document = await parseDocument(SMALL_POST)
    const revived = JSON.parse(JSON.stringify(document))

    expect(await renderHtmlFromDocument(revived)).toBe(SMALL_POST_HTML)
  })

  it('renders a revived 2,000-word document to the same HTML as the fresh one', async () => {
    const document = await parseDocument(generatePost(2000))
    const revived = JSON.parse(JSON.stringify(document))
    const html = await renderHtmlFromDocument(document)

    expect(await renderHtmlFromDocument(revived)).toBe(html)
    expect(html.length).toBe(16641)
  })

  it('renders a revived document with handlers the parsing side never saw', async () => {
    const revived = JSON.parse(
      JSON.stringify(await parseDocument('Hello :badge[new]{tone="blue"}.')),
    )
    const html = await renderHtmlFromDocument(revived, {
      components: {
        badge: async (node, state) =>
          `<b data-tone="${String(node[1].tone)}">${await state.flow(node, state)}</b>`,
      },
    })

    expect(html).toBe('<p>\n  Hello <b data-tone="blue">new</b>.\n</p>')
  })
})

describe('what extract() reads from the document alone', () => {
  it('finds headings, internal and external links, images with alt and component usages', async () => {
    const document = await parseDocument(generatePost(2000))
    const extracted = extract(JSON.parse(JSON.stringify(document)))

    expect(extracted.headings).toHaveLength(16)
    expect(extracted.headings[0]).toStrictEqual({
      depth: 1,
      text: 'Staggering sensor reads',
      id: 'staggering-sensor-reads',
    })
    expect(extracted.headings[1]).toStrictEqual({
      depth: 2,
      text: 'Section 1: stagger plan 1',
      id: 'section-1-stagger-plan-1',
    })
    expect(extracted.links.filter((link) => link.kind === 'internal')).toHaveLength(16)
    expect(extracted.links.filter((link) => link.kind === 'external')).toHaveLength(15)
    expect(extracted.links[1]).toStrictEqual({
      href: '/notes/design-1/',
      text: 'design notes 1',
      kind: 'internal',
    })
    expect(extracted.links[2]).toStrictEqual({
      href: 'https://example.com/mossgrid/issues/1',
      text: 'upstream issue 1',
      kind: 'external',
    })
    expect(extracted.images).toStrictEqual([
      { src: '/img/tray.png', alt: 'A tray of seedlings', title: 'Tray' },
      { src: '/img/lamp.png', alt: 'A lamp over a tray', title: 'Lamp' },
    ])
    expect(extracted.components).toStrictEqual([
      { name: 'callout', props: { type: 'tip', title: 'Rule of thumb' } },
      { name: 'badge', props: { tone: 'blue' } },
    ])
    expect(extracted.words).toBe(1805)
  })

  it('reads nothing from an empty document', async () => {
    expect(extract(await parseDocument(''))).toStrictEqual({
      headings: [],
      links: [],
      images: [],
      components: [],
      words: 0,
    })
  })

  it('classifies hrefs: root-relative and relative are internal, # is an anchor, the rest is external', async () => {
    const document = await parseDocument(
      '[a](/x/) [b](y/) [c](../z/) [d](#top) [e](https://example.com/) [f](//cdn.example.com/x) [g](mailto:a@example.net) [h](https://site.example/own/)',
    )

    expect(extract(document).links.map((link) => [link.href, link.kind])).toStrictEqual([
      ['/x/', 'internal'],
      ['y/', 'internal'],
      ['../z/', 'internal'],
      ['#top', 'anchor'],
      ['https://example.com/', 'external'],
      ['//cdn.example.com/x', 'external'],
      ['mailto:a@example.net', 'external'],
      ['https://site.example/own/', 'internal'],
    ])
  })

  it('reads component props: booleans and JSON arrive decoded, # and . become id and class', async () => {
    const document = await parseDocument(
      '::chart{open data=\'{"a":1}\' items=\'["x","y"]\' #the-id .wide .tall}\nbody\n::',
    )

    expect(extract(document).components).toStrictEqual([
      {
        name: 'chart',
        props: { open: true, data: { a: 1 }, items: ['x', 'y'], id: 'the-id', class: 'wide tall' },
      },
    ])
  })

  it('counts only real components: every tag Markdown itself produces is native, and a card with slots is one usage', async () => {
    const document = await parseDocument(
      [
        '# h1\n\n## h2\n\n### h3\n\n#### h4\n\n##### h5\n\n###### h6',
        'Text with [a link](/x/), ![img](/i.png), **strong**, *em*, ~~del~~, `code`, [span]{.cls},',
        'a hard break  \nnext line.',
        '- item\n  - nested\n\n1. one\n2. two\n\n- [x] done\n- [ ] todo',
        '> quote\n\n---',
        '```ts\nconst a = 1\n```',
        '| a | b |\n|---|---|\n| 1 | 2 |',
        '::card\n#header\nHead\n\n#footer\nFoot\n::',
      ].join('\n\n'),
    )
    const tags = new Set<string>()
    const walk = (node: unknown): void => {
      if (!Array.isArray(node)) return
      if (typeof node[0] === 'string') tags.add(node[0])
      node.slice(2).forEach(walk)
    }
    document.nodes.forEach(walk)

    expect([...tags].filter((tag) => tag !== 'card').sort()).toStrictEqual([...NATIVE_TAGS].sort())
    expect(extract(document).components).toStrictEqual([{ name: 'card', props: {} }])
  })

  it('reads the props of a YAML block: numbers and booleans arrive as such, text stays text', async () => {
    const document = await parseDocument(
      '::chart\n---\nitems: [1, 2]\ncount: 3\nflag: false\nname: x\nnested:\n  a: 1\nraw: "{not json"\n---\nbody\n::',
    )

    expect(document.nodes[0]?.[1]).toStrictEqual({
      ':items': [1, 2],
      ':count': '3',
      ':flag': 'false',
      name: 'x',
      ':nested': { a: 1 },
      raw: '{not json',
    })
    expect(extract(document).components).toStrictEqual([
      {
        name: 'chart',
        props: {
          items: [1, 2],
          count: 3,
          flag: false,
          name: 'x',
          nested: { a: 1 },
          raw: '{not json',
        },
      },
    ])
  })

  it('counts an image without alt as alt: null, and ignores elements that came from raw HTML', async () => {
    const document = await parseDocument(
      '![](/a.png)\n\n<div class="x">hi</div>\n\n::note\nbody\n::',
    )

    expect(extract(document).images).toStrictEqual([{ src: '/a.png', alt: null, title: null }])
    expect(extract(document).components).toStrictEqual([{ name: 'note', props: {} }])
  })
})

describe('the version of Comark at runtime', () => {
  it('is not exported by comark, comark/utils, comark/render, comark/parse or @comark/html', async () => {
    const comark = await import('comark')
    const html = await import('@comark/html')

    expect(Object.keys(comark).sort()).toStrictEqual([
      'INCOMPLETE_IMAGE_PLACEHOLDER',
      'INCOMPLETE_LINK_PLACEHOLDER',
      'applyAutoUnwrap',
      'autoCloseMarkdown',
      'createComarkContext',
      'createMarkdownParser',
      'createSerializedMarkdownParser',
      'defineComarkPlugin',
      'parseFrontmatter',
      'parseMarkdown',
    ])
    expect(Object.keys(html).sort()).toStrictEqual([
      'createHtmlRenderer',
      'renderHtml',
      'renderHtmlFromDocument',
    ])
  })

  it('is not reachable through package.json either: it is not in the exports map', () => {
    const resolve = createRequire(import.meta.url).resolve

    expect(() => resolve('comark/package.json')).toThrow(
      expect.objectContaining({ code: 'ERR_PACKAGE_PATH_NOT_EXPORTED' }),
    )
    expect(() => resolve('@comark/html/package.json')).toThrow(
      expect.objectContaining({ code: 'ERR_PACKAGE_PATH_NOT_EXPORTED' }),
    )
  })

  it('is not in the document: meta stays empty', async () => {
    const document = await parseDocument(SMALL_POST)

    expect(document.meta).toStrictEqual({})
  })
})
