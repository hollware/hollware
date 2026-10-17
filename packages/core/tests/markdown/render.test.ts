import { describe, expect, it } from 'vite-plus/test'

import { contentFixture } from '../../../../tests/fixtures/content.ts'
import { renderHtml } from '../../src/markdown/render.ts'
import type { EntryDocument } from '../../src/markdown/types.ts'
import { accepted, file, unsafeThingsIn, warmUpComark } from './support.ts'

// Fails when: `renderHtml` (src/markdown/render.ts) stops copying the document through its own
// rules before `@comark/html` prints it, so that a stored document that no Markdown wrote prints a
// dangerous tag (`script`, `iframe`, `svg`, `style`, a tag that is not a name), an event handler
// under any of the names Comark and Vue give one, an unsafe URL or one that a character reference
// hides, an element that `@comark/html` prints as raw text (the `$` of raw HTML), or a comment
// that closes itself; or it changes what a document the pipeline wrote prints: the tags, the
// props of a component, the ids of the headings, a `&` in an attribute.

warmUpComark()

/** A stored document with these nodes: the renderer has to be safe for it whoever wrote it. */
function documentOf(nodes: unknown[], frontmatter: Record<string, unknown> = {}): EntryDocument {
  return JSON.parse(JSON.stringify({ frontmatter, meta: {}, nodes }))
}

const marker = (name: string) =>
  `<hollware-marker kind="raw-html" name="${name}"></hollware-marker>`

describe('the HTML of a document the pipeline wrote', () => {
  it('has the tags, the ids and the props of the document and nothing else', async () => {
    const { document } = await accepted(
      '# Title\n\nA [link](/en/blog/x/) and **bold**.\n\n::callout{type="tip"}\nTip.\n::\n\n- a\n- b\n\n```ts\nconst a = 1\n```\n\n![alt](/i.png)',
    )
    expect(await renderHtml(document)).toBe(
      [
        '<h1 id="title">Title</h1>',
        '<p>A <a href="/en/blog/x/">link</a> and <strong>bold</strong>.</p>',
        '<callout type="tip">',
        '  Tip.',
        '</callout>',
        '<ul>',
        '  <li>a</li>',
        '  <li>b</li>',
        '</ul>',
        '<pre language="ts"><code class="language-ts">const a = 1</code></pre>',
        '<p><img src="/i.png" alt="alt"></p>',
      ].join('\n'),
    )
  })

  it('prints a marker as an element with its kind, its name and its line, and the children of an unknown component inside it', async () => {
    const { document } = await accepted(file('Text <b>x</b>\n\n::callotu\nKeep this.\n::'))
    expect(await renderHtml(document)).toBe(
      [
        '<p>',
        `  Text <hollware-marker kind="raw-html" name="b" line="5"></hollware-marker>x<hollware-marker kind="raw-html" name="b" line="5"></hollware-marker>`,
        '</p>',
        '<hollware-marker kind="unknown-component" name="callotu" line="7">',
        '  Keep this.',
        '</hollware-marker>',
      ].join('\n'),
    )
  })

  it('prints the same HTML every time, and does not change the document it is given', async () => {
    const { document } = await accepted(contentFixture('blog/en/edge-caching-basics.md'))
    const before = JSON.stringify(document)
    const first = await renderHtml(document)
    expect(await renderHtml(document)).toBe(first)
    expect(JSON.stringify(document)).toBe(before)
  })

  it('says `&` once in an attribute, as `&amp;`, so that a browser reads the text that was written', async () => {
    // The title is `Q&A and &#106; and &amp;` once Markdown has read its character references.
    const { document } = await accepted('[a](/search?q=1&p=2 "Q&A and &amp;#106; and &amp;amp;")')
    expect(await renderHtml(document)).toBe(
      '<p><a href="/search?q=1&amp;p=2" title="Q&amp;A and &amp;#106; and &amp;amp;">a</a></p>',
    )
  })

  it('prints no tag and no attribute of the fixtures that is not on the list of what is safe', async () => {
    for (const path of [
      'blog/en/edge-caching-basics.md',
      'blog/es/cache-en-el-borde.md',
      'bench/long-post.md',
    ]) {
      const { document } = await accepted(contentFixture(path))
      expect(unsafeThingsIn(await renderHtml(document)), path).toStrictEqual([])
    }
  })
})

describe('the HTML of a document that no Markdown wrote', () => {
  it.each([
    ['a script element', [['script', {}, 'alert(1)']], marker('script')],
    [
      'an iframe, an svg that holds a script, and a style in capitals',
      [
        ['iframe', { src: 'https://evil.example/' }],
        ['svg', {}, ['script', {}, 'x']],
        ['STYLE', {}, 'x'],
      ],
      [marker('iframe'), marker('svg'), marker('STYLE')].join('\n'),
    ],
    [
      'tag names that are not names',
      [
        ['x onerror=alert(1)', {}],
        ['a>b', {}],
        ['1abc', {}],
        ['', {}],
      ],
      [marker('?'), marker('?'), marker('?'), marker('?')].join('\n'),
    ],
    [
      'a comment that closes itself and opens a script',
      [['p', {}, 'a', [null, {}, '--><script>x</script><!--'], 'b']],
      '<p>ab</p>',
    ],
    [
      'an element that Comark prints as raw text because it says it came from HTML',
      [['p', { $: { html: 1, block: 1 } }, '<script>alert(1)</script>']],
      '<p>&lt;script&gt;alert(1)&lt;/script&gt;</p>',
    ],
    [
      'an event handler under every name',
      [
        [
          'callout',
          {
            onclick: 'x',
            ':onclick': 'y',
            '@click': 'z',
            'v-on:click': 'w',
            type: 'tip',
            ONLOAD: 'q',
          },
          'x',
        ],
      ],
      '<callout type="tip">\n  x\n</callout>',
    ],
    [
      'URLs that run code, in the open and behind a character reference',
      [
        [
          'p',
          {},
          ['a', { href: 'javascript:alert(1)' }, '1'],
          ['a', { href: '&#106;avascript:alert(1)' }, '2'],
          ['a', { href: 'jav&#x09;ascript:alert(1)' }, '3'],
          ['img', { src: 'data:text/html,x' }],
          ['a', { href: '/ok?x=1&y=2' }, '4'],
          ['a', { href: 'https://ok.example/' }, '5'],
          ['a', { href: { a: 1 } }, '6'],
          [
            'callout',
            { action: 'javascript:x', poster: 'vbscript:y', cite: 'https://ok.example/' },
          ],
        ],
      ],
      '<p>\n  <a>1</a><a>2</a><a>3</a><img><a href="/ok?x=1&amp;y=2">4</a><a href="https://ok.example/">5</a><a>6</a>\n  <callout cite="https://ok.example/"></callout>\n</p>',
    ],
    [
      'the props of a component, which the schema judges and the renderer does not',
      [['callout', { style: 'color:red', class: 'wide', id: 'x', ':open': 'true' }, 'x']],
      '<callout style="color:red" class="wide" id="x" open>\n  x\n</callout>',
    ],
    [
      'the keys that the pipeline uses inside its rules',
      [['p', { $line: '3', $open: '2', $: { line: 1 } }, 'x']],
      '<p>x</p>',
    ],
    [
      'names that a site can give a component',
      [
        ['Callout', {}, 'a'],
        ['my-comp', {}, 'b'],
        ['my_comp.x', {}, 'c'],
      ],
      '<Callout>\n  a\n</Callout>\n<my-comp>\n  b\n</my-comp>\n<my_comp.x>\n  c\n</my_comp.x>',
    ],
    [
      'text with markup in it, which is text',
      [['p', {}, 'a < b & c > d "q" &lt; &amp; <script>']],
      '<p>a &lt; b & c &gt; d "q" &lt; &amp; &lt;script&gt;</p>',
    ],
    [
      'nodes that are not elements, and an element without props',
      [5, null, { a: 1 }, ['p', 'text', 'x'], ['p', null, 'y']],
      '<p>x</p>\n<p>y</p>',
    ],
  ])('prints %s as safe HTML', async (_name, nodes, html) => {
    expect(await renderHtml(documentOf(nodes))).toBe(html)
  })

  it('says `&` once in an attribute that a character reference could use to hide', async () => {
    const html = await renderHtml(
      documentOf([['a', { href: '/a', title: '&#106; &amp; &lt;b&gt; "q" <x>' }, 'x']]),
    )
    expect(html).toBe(
      '<a href="/a" title="&amp;#106; &amp;amp; &amp;lt;b&amp;gt; &quot;q&quot; &lt;x&gt;">x</a>',
    )
  })

  it.each([
    ['a URL that runs code', 'javascript:alert(1)', '<a>x</a>'],
    // Comark itself prints this one (T-59): the renderer reads the binding under its own rules.
    [
      'an SVG as a data URL, which Comark lets through',
      'data:image/svg+xml,<svg onload=x>',
      '<a>x</a>',
    ],
    ['a value that is no text', { a: 1 }, '<a>x</a>'],
    ['a page of the site, with its query', '/ok/?a=1&b=2', '<a href="/ok/?a=1&amp;b=2">x</a>'],
  ])(
    'reads a link bound to the frontmatter under the rules of a link: %s',
    async (_name, url, html) => {
      expect(
        await renderHtml(documentOf([['a', { ':href': 'frontmatter.url' }, 'x']], { url })),
      ).toBe(html)
    },
  )

  it('drops a link bound to a path the data does not have, and leaves other bindings to Comark', async () => {
    expect(
      await renderHtml(
        documentOf(
          [
            ['a', { ':href': 'frontmatter.missing.deep' }, 'x'],
            ['a', { ':href': 'frontmatter.url', ':title': 'frontmatter.t' }, 'y'],
          ],
          { t: 'Hello', url: 'https://ok.example/' },
        ),
      ),
    ).toBe('<a>x</a>\n<a href="https://ok.example/" title="Hello">y</a>')
  })

  it('stops at 100 levels, so a document cannot make it recurse until the stack is gone', async () => {
    let deep: unknown = 'leaf'
    for (let level = 0; level < 150; level++) deep = ['em', {}, deep]
    const html = await renderHtml(documentOf([deep]))
    expect(html.match(/<em>/g)).toHaveLength(100)
    expect(html).not.toContain('leaf')
  })
})
