import { describe, expect, it } from 'vite-plus/test'

import type { LinkRef } from '../../src/markdown/types.ts'
import {
  accepted,
  BLOG_OPTIONS,
  file,
  IDEOGRAPHIC_SPACE,
  NO_BREAK_SPACE,
  warmUpComark,
} from './support.ts'

warmUpComark()

const heading = async (text: string) => (await accepted(`# ${text}`)).extracted.headings[0]

describe('heading ids', () => {
  it('keep the letters outside ASCII: Diseño is diseño', async () => {
    expect(await heading('Diseño')).toStrictEqual({
      depth: 1,
      text: 'Diseño',
      id: 'diseño',
      line: 1,
    })
  })

  it.each([
    ['Diseño del planificador', 'diseño-del-planificador'],
    ['¿Qué es Mossgrid?', 'qué-es-mossgrid'],
    ['A & B', 'a-b'],
    ['Café au lait', 'café-au-lait'],
    ['日本語 見出し', '日本語-見出し'],
    ['Straße', 'straße'],
    ['foo--bar', 'foo-bar'],
    ['2026 results', '2026-results'],
    ['snake_case_name', 'snake_case_name'],
    ['  spaced   out  ', 'spaced-out'],
    ['🚀 Launch', 'launch'],
    ['Café', 'café'],
    ['Using **bold**, `code` and [a link](/x/)', 'using-bold-code-and-a-link'],
  ])('make %s the id %s', async (text, id) => {
    expect((await heading(text))?.id).toBe(id)
  })

  it('are `section` for a heading with no letter or digit', async () => {
    const { extracted } = await accepted('# 🚀\n\n# ???\n\n# 🚀')
    expect(extracted.headings.map((item) => item.id)).toStrictEqual([
      'section',
      'section-1',
      'section-2',
    ])
  })

  it('are unique in the document, even across levels and when a title looks like a suffix', async () => {
    const { extracted } = await accepted(
      '# Setup\n\n## Setup\n\n### Setup\n\n## Setup 1\n\n## Setup',
    )
    expect(extracted.headings.map((item) => item.id)).toStrictEqual([
      'setup',
      'setup-1',
      'setup-2',
      'setup-1-1',
      'setup-3',
    ])
  })

  it('go to the document as the only prop of the heading', async () => {
    const { document } = await accepted('## Diseño {#mine .big}')
    expect(document.nodes).toStrictEqual([['h2', { id: 'diseño' }, 'Diseño']])
  })

  it('stay unique and fast for thousands of headings with the same text', async () => {
    const { extracted } = await accepted('# h\n'.repeat(5000))
    const ids = new Set(extracted.headings.map((item) => item.id))
    expect(ids.size).toBe(5000)
    expect(extracted.headings[4999]?.id).toBe('h-4999')
  })
})

describe('links', () => {
  const kind = async (href: string, options = BLOG_OPTIONS): Promise<LinkRef | undefined> =>
    (await accepted(`[x](${href})`, options)).extracted.links[0]

  const en = (slug: string) => ({ collection: 'blog', locale: 'en', slug })

  it.each([
    ['/en/blog/foo/', 'internal', en('foo')],
    ['/en/blog/foo', 'internal', en('foo')],
    ['/en/blog/foo?utm=1#top', 'internal', en('foo')],
    ['/en/blog/foo/#top', 'internal', en('foo')],
    ['/blog/bar/', 'internal', { collection: 'blog', locale: 'es', slug: 'bar' }],
    ['/en/blog/caf%C3%A9/', 'internal', en('café')],
    ['/en/blog/100%25/', 'internal', en('100%')],
    ['/en/blog/%E0%A4/', 'internal', en('%E0%A4')],
    ['/en/blog/', 'site', undefined],
    ['/en/blog/a/b/', 'site', undefined],
    ['/en/blog//', 'site', undefined],
    ['/en/blog/foo//', 'site', undefined],
    ['/EN/blog/foo/', 'site', undefined],
    ['/about/', 'site', undefined],
    ['/', 'site', undefined],
    ['rel/path', 'site', undefined],
    ['../up/', 'site', undefined],
    ['?q=1', 'site', undefined],
    ['#top', 'anchor', undefined],
    ['https://example.com/en/blog/foo/', 'external', undefined],
    ['http://example.com', 'external', undefined],
    ['mailto:a@b.co', 'external', undefined],
    ['//cdn.example.com/x', 'external', undefined],
  ] as const)('read %s as %s', async (href, expected, target) => {
    const link = await kind(href)
    expect(link?.href).toBe(href)
    expect(link?.kind).toBe(expected)
    expect(link?.target).toStrictEqual(target)
  })

  it('are all site paths when the site has no routes', async () => {
    expect((await kind('/en/blog/foo/', { ...BLOG_OPTIONS, routes: {} }))?.kind).toBe('site')
  })

  it('name the collection by its name when two routes match, whatever the order of the config', async () => {
    const forward = { zeta: { en: '/en/:slug/' }, alpha: { en: '/en/:slug/' } }
    const backward = { alpha: { en: '/en/:slug/' }, zeta: { en: '/en/:slug/' } }
    for (const routes of [forward, backward]) {
      const link = await kind('/en/x/', { ...BLOG_OPTIONS, routes })
      expect(link?.target).toStrictEqual({ collection: 'alpha', locale: 'en', slug: 'x' })
    }
  })

  it('match a route written without its trailing slash, and ignore a route without a slug', async () => {
    const routes = {
      docs: { en: '/en/docs/:slug' },
      about: { en: '/en/about/' },
      bad: { en: 'docs/:slug/' },
    }
    expect((await kind('/en/docs/start/', { ...BLOG_OPTIONS, routes }))?.target).toStrictEqual({
      collection: 'docs',
      locale: 'en',
      slug: 'start',
    })
    expect((await kind('/en/about/', { ...BLOG_OPTIONS, routes }))?.kind).toBe('site')
    expect((await kind('/docs/x/', { ...BLOG_OPTIONS, routes }))?.kind).toBe('site')
  })

  it('list a link that wraps a title, an image or emphasis once, with the line it starts on', async () => {
    const { extracted } = await accepted(
      'See [a **bold** link\nover two lines](/en/blog/foo/ "A title").',
    )
    expect(extracted.links).toStrictEqual([
      { href: '/en/blog/foo/', kind: 'internal', target: en('foo'), line: 1 },
    ])
  })

  it('include a bare URL and an address, which Markdown makes links of, and leave README.md alone', async () => {
    const { extracted } = await accepted(
      'See https://example.com/x, write to a@b.co, and read README.md or www.example.com.\n\nThe CDN is //cdn.example.com/y',
    )
    expect(extracted.links.map((link) => [link.href, link.kind])).toStrictEqual([
      ['https://example.com/x', 'external'],
      ['mailto:a@b.co', 'external'],
      ['//cdn.example.com/y', 'external'],
    ])
  })

  it('follow a reference definition, which leaves no node of its own', async () => {
    const { document, extracted } = await accepted(
      '[x][ref]\n\n[ref]: https://example.com/ref "Ref title"',
    )
    expect(extracted.links).toStrictEqual([
      { href: 'https://example.com/ref', kind: 'external', line: 1 },
    ])
    expect(document.nodes).toStrictEqual([
      ['p', {}, ['a', { href: 'https://example.com/ref', title: 'Ref title' }, 'x']],
    ])
  })
})

describe('images', () => {
  it('have the alt that is written, which is the empty string when there is none', async () => {
    const { extracted } = await accepted(
      '![A cat](/cat.png "Tray") ![](/empty.png) ![ ](/space.png)\n\n![ref alt][r]\n\n[r]: /ref.png',
    )
    expect(extracted.images).toStrictEqual([
      { src: '/cat.png', alt: 'A cat', line: 1 },
      { src: '/empty.png', alt: '', line: 1 },
      { src: '/space.png', alt: ' ', line: 1 },
      { src: '/ref.png', alt: 'ref alt', line: 3 },
    ])
  })

  it('keep the width and the height they were given, which are allowed on an image', async () => {
    const { document, extracted } = await accepted('![A cat](/cat.png){width=100 height="50"}')
    expect(extracted.disallowed).toStrictEqual([])
    expect(document.nodes).toStrictEqual([
      ['p', {}, ['img', { src: '/cat.png', alt: 'A cat', width: '100', height: '50' }]],
    ])
  })

  it('are not listed without a source', async () => {
    expect((await accepted('![alt]()')).extracted.images).toStrictEqual([])
  })
})

describe('components', () => {
  const props = async (markdown: string) =>
    (await accepted(markdown)).extracted.components[0]?.props

  it('give the props a schema should see, not the way Comark stores them', async () => {
    expect(await props('::callout{open}\nx\n::')).toStrictEqual({ open: true })
    expect(await props('::callout{count="3"}\nx\n::')).toStrictEqual({ count: '3' })
    expect(await props('::callout{:count="3" :flag="false" :gone="null"}\nx\n::')).toStrictEqual({
      count: 3,
      flag: false,
      gone: null,
    })
    expect(await props(`::callout{data='{"a":1}' items='["x","y"]'}\nx\n::`)).toStrictEqual({
      data: { a: 1 },
      items: ['x', 'y'],
    })
    expect(await props('::callout{:title="frontmatter.title"}\nx\n::')).toStrictEqual({
      title: 'frontmatter.title',
    })
    expect(await props('::callout{#the-id .wide .tall}\nx\n::')).toStrictEqual({
      id: 'the-id',
      class: 'wide tall',
    })
  })

  it('keep the props as Comark stores them in the document', async () => {
    const { document } = await accepted('::callout{open :count="3" type="tip"}\nx\n::')
    expect(document.nodes).toStrictEqual([
      ['callout', { ':open': 'true', ':count': '3', type: 'tip' }, 'x'],
    ])
  })

  it('are listed in document order, nested ones after the one that holds them', async () => {
    const { extracted } = await accepted(
      '::callout{type="tip"}\nText.\n\n::youtube{id="dQw4w9WgXcQ"}\n::\n::\n\nAnd :badge[new]{tone="blue"} inline.',
      { ...BLOG_OPTIONS, components: ['callout', 'youtube', 'badge'] },
    )
    expect(extracted.components).toStrictEqual([
      { name: 'callout', props: { type: 'tip' }, line: 1 },
      { name: 'youtube', props: { id: 'dQw4w9WgXcQ' }, line: 4 },
      { name: 'badge', props: { tone: 'blue' }, line: 8 },
    ])
  })

  it('are the uses of the components of the collection, matched by the exact name', async () => {
    const { extracted } = await accepted('::callout\nx\n::\n\n:Badge[y] and :badge[z]\n', {
      ...BLOG_OPTIONS,
      components: ['callout', 'badge'],
    })
    expect(extracted.components.map((use) => use.name)).toStrictEqual(['callout', 'badge'])
    expect(extracted.disallowed.map((item) => item.name)).toStrictEqual(['Badge'])
  })

  it('read `::YouTube` as the name Comark gives it, which is you-tube', async () => {
    const { extracted } = await accepted('::YouTube{id="x"}\n::')
    expect(extracted.disallowed).toStrictEqual([
      { kind: 'unknown-component', name: 'you-tube', line: 1 },
    ])
  })
})

describe('words', () => {
  const words = async (markdown: string) => (await accepted(markdown)).extracted.words

  it.each([
    ['', 0],
    ['one two  three\nfour', 4],
    ['**bold**text and *em*phasis', 3],
    ['[two words](https://example.com/a/b)', 2],
    ['<https://example.com>', 1],
    ['![alt text here](/a.png)', 0],
    ['use `vp check` now', 4],
    ['```ts\nconst a = 1\n```', 0],
    ['# Two words\n\n- three words here\n- one', 6],
    ['- a\n- b\n\n1. c\n2. d', 4],
    ['| a | b |\n|---|---|\n| c | d |', 4],
    ['> quoted words\n\nnext', 3],
    ['a  \nb and c\\\nd', 5],
    ['[Enter] key', 2],
    ['a' + NO_BREAK_SPACE + 'b' + IDEOGRAPHIC_SPACE + 'c', 3],
    ['Qué es Mossgrid', 3],
    ['日本語 見出し', 2],
    ['::callout\ninside text\n::', 2],
    ['before\n\n::callout\nx\n::\n\nafter', 3],
    ['- [x] done\n- [ ] todo', 2],
  ])('count %j as %i', async (markdown, count) => {
    expect(await words(markdown)).toBe(count)
  })

  it('leave the frontmatter out', async () => {
    expect(await words(file('one two', 'title: A long title here'))).toBe(2)
  })

  it('count a word that raw HTML cuts as two, because the marker stands between them', async () => {
    expect(await words('foo<b>bar')).toBe(2)
  })
})

describe('lines', () => {
  it('are the lines of the file, for every block and for what is inside a wrapped paragraph', async () => {
    const markdown = file(
      [
        '# Title',
        '',
        'First line [a](/en/blog/a/)',
        'second ![i](/i.png) line',
        'third :badge[x] line  ',
        'after a hard break [b](/en/blog/b/)',
        '',
        '- item [c](/en/blog/c/)',
        '- item d',
        '',
        '> quote',
        '> [d](/en/blog/d/)',
        '',
        '| h | [e](/en/blog/e/) |',
        '|---|---|',
        '| [f](/en/blog/f/) | x |',
        '',
        '::callout{type="tip"}',
        'Inside a [g](/en/blog/g/)',
        '::',
        '',
        '## Second',
      ].join('\n'),
    )
    const { extracted } = await accepted(markdown, {
      ...BLOG_OPTIONS,
      components: ['callout', 'badge'],
    })
    expect(extracted.headings.map((item) => item.line)).toStrictEqual([5, 26])
    expect(extracted.links.map((link) => [link.href.slice(9), link.line])).toStrictEqual([
      ['a/', 7],
      ['b/', 10],
      ['c/', 12],
      ['d/', 16],
      ['e/', 18],
      ['f/', 20],
      ['g/', 23],
    ])
    expect(extracted.images.map((image) => image.line)).toStrictEqual([8])
    expect(extracted.components.map((use) => [use.name, use.line])).toStrictEqual([
      ['badge', 9],
      ['callout', 22],
    ])
  })

  it('count a block that comes after a code block, a rule and a blank line as the block it is', async () => {
    const { extracted } = await accepted('```\ncode\n\nmore\n```\n\n---\n\n# After')
    expect(extracted.headings).toStrictEqual([{ depth: 1, text: 'After', id: 'after', line: 9 }])
  })
})
