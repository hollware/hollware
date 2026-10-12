import { createMarkdownParser } from 'comark'
import { createHtmlRenderer, renderHtmlFromDocument } from '@comark/html'
import { describe, expect, it } from 'vitest'
import { parseDocument, processMarkdown } from '../../src/pipeline.ts'
import { createSafeParser } from '../../src/safe.ts'

// Behavior of comark 0.7.0 and @comark/html 0.7.0 that the Markdown pipeline has to know, each pinned
// with the literal output it has today. Fails when: an upgrade fixes or changes one of them (then the
// workaround in the pipeline can go, or must change), or when a pipeline option below stops doing what
// the report says it does.

const render = createHtmlRenderer()

describe('heading ids', () => {
  it('keep only ASCII letters and digits: accents are dropped, not transliterated', async () => {
    const { extracted } = await processMarkdown('# Diseño del planificador\n\n## ¿Qué es Mossgrid?')

    expect(extracted.headings).toStrictEqual([
      { depth: 1, text: 'Diseño del planificador', id: 'diseo-del-planificador' },
      { depth: 2, text: '¿Qué es Mossgrid?', id: 'qu-es-mossgrid' },
    ])
  })

  it('h3 and deeper carry the parent slug, a leading digit gets "_", repeats get -1', async () => {
    const { extracted } = await processMarkdown(
      '# A\n\n## Same\n\n### Deep\n\n## Same\n\n### Deep\n\n## 2026 results',
    )

    expect(extracted.headings.map((heading) => heading.id)).toStrictEqual([
      'a',
      'same',
      'same-deep',
      'same-1',
      'same-deep-1',
      '_2026-results',
    ])
  })

  it('headingIds: false drops the generated ids, an explicit {#id} survives', async () => {
    const parse = createMarkdownParser({ headingIds: false })
    const document = await parse('# Plain\n\n## Hello world {#custom-id}')

    expect(document.nodes).toStrictEqual([
      ['h1', {}, 'Plain'],
      ['h2', { id: 'custom-id' }, 'Hello world'],
    ])
  })
})

describe('what the document does not tell apart or adds', () => {
  it('an empty alt and a missing alt are the same: no alt at all', async () => {
    const document = await parseDocument('![](/a.png)\n\n![alt text](/b.png)\n\n<img src="/c.png">')

    expect(document.nodes).toStrictEqual([
      ['p', {}, ['img', { src: '/a.png' }]],
      ['p', {}, ['img', { src: '/b.png', alt: 'alt text' }]],
      ['img', { $: { html: 1, block: 1 }, src: '/c.png' }],
    ])
  })

  it('a link reference definition leaves an empty component node behind', async () => {
    const document = await parseDocument('[x][ref]\n\n[ref]: https://example.com/ref "Ref title"')

    expect(document.nodes).toStrictEqual([
      ['p', {}, ['a', { href: 'https://example.com/ref', title: 'Ref title' }, 'x']],
      ['component', {}],
    ])
    expect(await render('[x][ref]\n\n[ref]: https://example.com/ref')).toBe(
      '<p><a href="https://example.com/ref">x</a></p>\n<component></component>',
    )
  })

  it('raw inline HTML with target="_blank" leaks an underscore after the element', async () => {
    const document = await parseDocument('x <a href="https://e.example" target="_blank">y</a> z')

    expect(document.nodes).toStrictEqual([
      [
        'p',
        {},
        'x ',
        ['a', { $: { html: 1, block: 0 }, href: 'https://e.example', target: '_blank' }, 'y'],
        ' z_',
      ],
    ])
  })

  it('elements that came from raw HTML carry $.html = 1 in their props', async () => {
    const document = await parseDocument('<div class="x">hi</div>\n\n**md**')

    expect(document.nodes).toStrictEqual([
      ['div', { $: { html: 1, block: 1 }, class: 'x' }, 'hi'],
      ['p', {}, ['strong', {}, 'md']],
    ])
  })

  it('GFM alert and task list props are not plain HTML attributes', async () => {
    const document = await parseDocument('> [!NOTE]\n> Careful\n\n- [x] done')

    expect(document.nodes).toStrictEqual([
      ['blockquote', { as: 'note' }, 'Careful'],
      [
        'ul',
        { class: 'contains-task-list' },
        [
          'li',
          { class: 'task-list-item' },
          [
            'input',
            {
              class: 'task-list-item-checkbox',
              type: 'checkbox',
              ':disabled': 'true',
              ':checked': 'true',
            },
          ],
          ' done',
        ],
      ],
    ])
  })

  it('boolean and JSON component props are stored under a ":" key or parsed', async () => {
    const document = await parseDocument(
      '::chart{open data=\'{"a":1}\' #the-id .wide .tall}\nbody\n::',
    )

    expect(document.nodes).toStrictEqual([
      ['chart', { ':open': 'true', data: { a: 1 }, id: 'the-id', class: 'wide tall' }, 'body'],
    ])
  })
})

describe('HTML output fidelity', () => {
  it('text is not entity-escaped: Markdown "&amp;lt;" comes out as "&lt;", which a browser shows as "<"', async () => {
    expect(await render('AT&T and &lt;b&gt; and &amp;lt; and 1 < 2 > 0')).toBe(
      '<p>AT&T and &lt;b&gt; and &lt; and 1 &lt; 2 &gt; 0</p>',
    )
  })

  it('a code span and a code block with entity-like text come out decoded too', async () => {
    expect(await render('`&lt;b&gt;`')).toBe('<p><code>&lt;b&gt;</code></p>')
    expect(await render('```html\n<div class="a">&amp; x</div>\n```')).toBe(
      '<pre language="html"><code class="language-html">&lt;div class="a"&gt;&amp; x&lt;/div&gt;</code></pre>',
    )
  })

  it('an image without alt is rendered without an alt attribute (decorative and missing alike)', async () => {
    expect(await render('![](/a.png)')).toBe('<p><img src="/a.png"></p>')
  })
})

describe('autoClose, on by default for streaming', () => {
  const on = createMarkdownParser()
  const off = createMarkdownParser({ autoClose: false })

  it('turns an unfinished link into a link to a made-up URL', async () => {
    const closed = await on('[link](https://example.com')
    const open = await off('[link](https://example.com')

    expect(closed.nodes).toStrictEqual([
      ['p', {}, ['a', { href: 'comark:incomplete-link' }, 'link']],
    ])
    expect(open.nodes).toStrictEqual([
      ['p', {}, '[link](', ['a', { href: 'https://example.com' }, 'https://example.com']],
    ])
  })

  it('leaks a placeholder into the text for an unfinished inline component', async () => {
    const closed = await on('x :badge[y z')

    expect(closed.nodes).toStrictEqual([
      ['p', {}, 'x ', ['badge', {}, 'y z'], '(comark:incomplete-link)'],
    ])
  })

  it('overflows the stack on 5,000 open emphasis markers; without it the same input parses', async () => {
    const markdown = '*a '.repeat(5000)

    await expect(on(markdown)).rejects.toThrow(RangeError)
    expect((await off(markdown)).nodes).toHaveLength(1)
  })

  it('src/safe.ts parses with autoClose off by default', async () => {
    const parse = createSafeParser([])
    const document = await parse('[link](https://example.com')

    expect(document.nodes).toStrictEqual([
      ['p', {}, '[link](', ['a', { href: 'https://example.com' }, 'https://example.com']],
    ])
  })
})

describe('input the parser rejects or does not see', () => {
  it('malformed YAML frontmatter throws a YAMLException that names line and column', async () => {
    const error = await parseDocument('---\ntitle: [unclosed\n---\n# x').catch(
      (caught: unknown) => caught,
    )

    expect(error).toBeInstanceOf(Error)
    expect(error instanceof Error && error.name).toBe('YAMLException')
    expect(error instanceof Error && error.message).toContain(
      'unexpected end of the stream within a flow collection (1:17)',
    )
  })

  it('a YAML tag that builds JavaScript values is refused', async () => {
    const error = await parseDocument('---\na: !!js/function "function(){}"\n---\n# x').catch(
      (caught: unknown) => caught,
    )

    expect(error instanceof Error && error.name).toBe('YAMLException')
  })

  it('keeps YAML dates, yes/no and 007 as strings (JSON schema), numbers and booleans as such', async () => {
    const document = await parseDocument(
      '---\nd: 2026-03-14\nt: 2026-03-14T10:00:00Z\nn: 007\nb: yes\nflag: true\nnum: 7\nnothing: ~\n---\n# x',
    )

    expect(document.frontmatter).toStrictEqual({
      d: '2026-03-14',
      t: '2026-03-14T10:00:00Z',
      n: '007',
      b: 'yes',
      flag: true,
      num: 7,
      nothing: '~',
    })
  })

  it('a leading byte order mark hides the frontmatter (strip it before parsing)', async () => {
    const document = await parseDocument('﻿---\ntitle: a\n---\n# x')

    expect(document.frontmatter).toStrictEqual({})
  })

  it('CRLF line endings are fine', async () => {
    const document = await parseDocument('---\r\ntitle: a\r\n---\r\n\r\n# Hi\r\n')

    expect(document.frontmatter).toStrictEqual({ title: 'a' })
    expect(document.nodes).toStrictEqual([['h1', { id: 'hi' }, 'Hi']])
  })

  it('a non-string input throws a TypeError (validate before calling)', async () => {
    const parse = createMarkdownParser()

    await expect(Reflect.apply(parse, undefined, [undefined])).rejects.toThrow(TypeError)
  })
})

describe('reuse', () => {
  it('a reused parser and a new parser per call give the same document', async () => {
    const markdown = '# Title\n\nSome **text** with a [link](/a/) and :badge[x]{tone="blue"}.\n'
    const reused = createMarkdownParser()

    expect(await reused(markdown)).toStrictEqual(await createMarkdownParser()(markdown))
    expect(await reused(markdown)).toStrictEqual(await reused(markdown))
    expect(await renderHtmlFromDocument(await reused(markdown))).toBe(
      '<h1 id="title">Title</h1>\n<p>\n  Some <strong>text</strong> with a <a href="/a/">link</a> and <badge tone="blue">x</badge>.\n</p>',
    )
  })
})
