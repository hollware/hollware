import { describe, expect, it } from 'vite-plus/test'

import { contentFixture } from '../../../../tests/fixtures/content.ts'
import type { DisallowedMarker } from '../../src/markdown/types.ts'
import { renderHtml } from '../../src/markdown/render.ts'
import {
  accepted,
  BLOG_OPTIONS,
  expectNoActiveContent,
  file,
  refused,
  unsafeThingsIn,
  warmUpComark,
} from './support.ts'

warmUpComark()

const marker = (kind: DisallowedMarker['kind'], name: string, line: number): DisallowedMarker => ({
  kind,
  name,
  line,
})

describe('the hostile fixtures', () => {
  const EXPECTED: Record<string, readonly DisallowedMarker[]> = {
    'hostile/raw-html.md': [marker('raw-html', 'script', 10), marker('raw-html', 'img', 10)],
    'hostile/block-html.md': [
      marker('raw-html', 'iframe', 10),
      marker('raw-html', 'svg', 12),
      marker('raw-html', 'script', 12),
    ],
    'hostile/unknown-component.md': [marker('unknown-component', 'youtub', 12)],
    'hostile/disallowed-attribute.md': [
      marker('disallowed-attribute', 'a[onclick]', 10),
      marker('disallowed-attribute', 'img[style]', 10),
    ],
    'hostile/unsafe-url.md': [
      marker('unsafe-url', 'javascript:alert(1)', 10),
      marker('unsafe-url', 'vbscript:msgbox(1)', 10),
      marker('unsafe-url', 'data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=', 10),
    ],
    'hostile/nested-emphasis.md': [],
    'hostile/bom.md': [],
  }

  it.each(Object.entries(EXPECTED))('%s gives exactly its markers', async (path, disallowed) => {
    const { extracted } = await accepted(contentFixture(path))
    expect(extracted.disallowed).toStrictEqual(disallowed)
  })

  it.each(Object.keys(EXPECTED))(
    '%s renders to HTML with no script, handler or unsafe URL, and no hostile byte in the document',
    async (path) => {
      const { document } = await accepted(contentFixture(path))
      expectNoActiveContent(await renderHtml(document))
      const stored = JSON.stringify(document)
      for (const hostile of [
        '<script',
        '<iframe',
        '<img',
        'onerror',
        'onclick',
        'javascript:',
        'vbscript:',
        'position:fixed',
        'data:image/svg',
      ]) {
        expect(stored).not.toContain(hostile)
      }
    },
  )

  it('refuses the fixture whose frontmatter does not parse', async () => {
    const violations = await refused(contentFixture('hostile/broken-frontmatter.md'))
    expect(violations.map((violation) => violation.contract)).toStrictEqual(['frontmatter-syntax'])
  })

  it('leaves 5,000 unclosed emphasis marks as the text they are', async () => {
    const { document, extracted } = await accepted(contentFixture('hostile/nested-emphasis.md'))
    expect(document.nodes).toHaveLength(1)
    expect(document.nodes[0]?.[0]).toBe('p')
    expect(extracted.words).toBe(5000)
  })
})

describe('what a marker looks like', () => {
  it('replaces each piece of raw HTML with a marker that has its line, and keeps the text between', async () => {
    const { document } = await accepted(contentFixture('hostile/raw-html.md'))
    expect(document.nodes).toStrictEqual([
      [
        'p',
        {},
        'Inline HTML: ',
        ['hollware-marker', { kind: 'raw-html', name: 'script', line: 10 }],
        'alert(1)',
        ['hollware-marker', { kind: 'raw-html', name: 'script', line: 10 }],
        ' and ',
        ['hollware-marker', { kind: 'raw-html', name: 'img', line: 10 }],
        '.',
      ],
    ])
  })

  it('makes a typo in a component name a marker, not a missing paragraph', async () => {
    const { document } = await accepted(contentFixture('hostile/unknown-component.md'))
    expect(document.nodes).toStrictEqual([
      ['p', {}, 'A typo in a component name:'],
      ['hollware-marker', { kind: 'unknown-component', name: 'youtub', line: 12 }],
    ])
  })

  it('keeps what is inside an unknown component, and drops its props', async () => {
    const { document, extracted } = await accepted(
      '::callotu{type="tip" onclick="alert(1)"}\nKeep the slug short.\n::',
    )
    expect(document.nodes).toStrictEqual([
      [
        'hollware-marker',
        { kind: 'unknown-component', name: 'callotu', line: 1 },
        'Keep the slug short.',
      ],
    ])
    expect(extracted.disallowed).toStrictEqual([marker('unknown-component', 'callotu', 1)])
    expect(extracted.words).toBe(4)
  })

  it('judges what is inside an unknown component too', async () => {
    const { extracted } = await accepted('::callotu\n:badg[new] and <b>x</b>\n::')
    expect(extracted.disallowed).toStrictEqual([
      marker('unknown-component', 'callotu', 1),
      marker('unknown-component', 'badg', 2),
      marker('raw-html', 'b', 2),
    ])
  })

  it('cuts a very long name, so that a data URL is not echoed whole', async () => {
    const url = `data:text/html,${'a'.repeat(500)}`
    const { extracted } = await accepted(`[x](${url})`)
    expect(extracted.disallowed).toStrictEqual([marker('unsafe-url', `${url.slice(0, 97)}...`, 1)])
  })
})

describe('what the pipeline does with the spike table of attacks', () => {
  interface Attack {
    readonly name: string
    readonly markdown: string
    readonly components?: readonly string[]
    readonly disallowed: readonly DisallowedMarker[]
  }

  const ATTACKS: readonly Attack[] = [
    {
      name: 'raw block script',
      markdown: '<script>alert(1)</script>',
      disallowed: [marker('raw-html', 'script', 1)],
    },
    {
      name: 'raw inline script',
      markdown: 'before <script>alert(1)</script> after',
      disallowed: [marker('raw-html', 'script', 1)],
    },
    {
      name: 'raw img onerror',
      markdown: '<img src=x onerror=alert(1)>',
      disallowed: [marker('raw-html', 'img', 1)],
    },
    {
      name: 'raw a javascript href',
      markdown: '<a href="javascript:alert(1)">x</a>',
      disallowed: [marker('raw-html', 'a', 1)],
    },
    {
      name: 'raw iframe srcdoc',
      markdown: '<iframe srcdoc="<script>alert(1)</script>"></iframe>',
      disallowed: [marker('raw-html', 'iframe', 1)],
    },
    {
      name: 'raw style',
      markdown: '<style>body{display:none}</style>',
      disallowed: [marker('raw-html', 'style', 1)],
    },
    {
      name: 'raw comment',
      markdown: '<!-- hidden -->\n\nafter',
      disallowed: [marker('raw-html', '!--', 1)],
    },
    {
      name: 'raw processing instruction, declaration and CDATA',
      markdown: '<?php x ?>\n\n<!DOCTYPE html>\n\n<![CDATA[ x ]]>',
      disallowed: [
        marker('raw-html', '?', 1),
        marker('raw-html', '!doctype', 3),
        marker('raw-html', '![cdata[', 5),
      ],
    },
    {
      name: 'markdown link javascript:',
      markdown: '[x](javascript:alert(1))',
      disallowed: [marker('unsafe-url', 'javascript:alert(1)', 1)],
    },
    {
      name: 'markdown image javascript:',
      markdown: '![x](javascript:alert(1))',
      disallowed: [marker('unsafe-url', 'javascript:alert(1)', 1)],
    },
    {
      name: 'autolink javascript:',
      markdown: '<javascript:alert(1)>',
      disallowed: [marker('unsafe-url', 'javascript:alert(1)', 1)],
    },
    {
      name: 'link with the scheme in capitals',
      markdown: '[x](JaVaScRiPt:alert(1))',
      disallowed: [marker('unsafe-url', 'JaVaScRiPt:alert(1)', 1)],
    },
    {
      name: 'link entity-encoded javascript:',
      markdown: '[x](&#106;avascript:alert(1))',
      disallowed: [marker('unsafe-url', 'javascript:alert(1)', 1)],
    },
    {
      name: 'link data:text/html',
      markdown: '[x](data:text/html,hello)',
      disallowed: [marker('unsafe-url', 'data:text/html,hello', 1)],
    },
    {
      name: 'link ftp:',
      markdown: '[x](ftp://example.com/x)',
      disallowed: [marker('unsafe-url', 'ftp://example.com/x', 1)],
    },
    {
      name: 'image data: of a type that is a picture',
      markdown: '![x](data:image/png;base64,AAAA)',
      disallowed: [marker('unsafe-url', 'data:image/png;base64,AAAA', 1)],
    },
    {
      name: 'image mailto:',
      markdown: '![x](mailto:a@b.co)',
      disallowed: [marker('unsafe-url', 'mailto:a@b.co', 1)],
    },
    {
      name: 'link attribute href',
      markdown: '[x](/a){href="javascript:alert(1)"}',
      disallowed: [marker('unsafe-url', 'javascript:alert(1)', 1)],
    },
    {
      name: 'link attribute href with a character reference',
      markdown: '[x](/a){href="&#106;avascript:alert(1)"}',
      disallowed: [marker('unsafe-url', '&#106;avascript:alert(1)', 1)],
    },
    {
      name: 'link attribute href with a tab hidden in the scheme',
      markdown: '[x](/a){href="jav&#x09;ascript:alert(1)"}',
      disallowed: [marker('unsafe-url', 'jav&#x09;ascript:alert(1)', 1)],
    },
    {
      name: 'link attribute onclick',
      markdown: '[x](/a){onclick="alert(1)"}',
      disallowed: [marker('disallowed-attribute', 'a[onclick]', 1)],
    },
    {
      name: 'attributes on emphasis, code and a paragraph',
      markdown: '**b**{onclick="alert(1)"} `c`{.big} and a word {open}',
      disallowed: [
        marker('disallowed-attribute', 'p[open]', 1),
        marker('disallowed-attribute', 'strong[onclick]', 1),
        marker('disallowed-attribute', 'code[class]', 1),
      ],
    },
    {
      name: 'an id and a class on a heading',
      markdown: '# Title {#mine .big}',
      disallowed: [
        marker('disallowed-attribute', 'h1[id]', 1),
        marker('disallowed-attribute', 'h1[class]', 1),
      ],
    },
    {
      name: 'block component href and onclick',
      markdown: '::callout{href="javascript:alert(1)" onclick="alert(1)"}\nbody\n::',
      disallowed: [
        marker('unsafe-url', 'javascript:alert(1)', 1),
        marker('disallowed-attribute', 'callout[onclick]', 1),
      ],
    },
    {
      name: 'inline component href and onclick',
      markdown: 'x :badge[y]{href="javascript:alert(1)" onclick="alert(1)"} z',
      components: ['badge'],
      disallowed: [
        marker('unsafe-url', 'javascript:alert(1)', 1),
        marker('disallowed-attribute', 'badge[onclick]', 1),
      ],
    },
    {
      name: 'inline component that the collection does not declare',
      markdown: 'x :badge[y]{href="javascript:alert(1)" onclick="alert(1)"} z',
      disallowed: [marker('unknown-component', 'badge', 1)],
    },
    {
      name: 'component binding :href',
      markdown: '::callout{:href="javascript:alert(1)"}\nbody\n::',
      disallowed: [marker('unsafe-url', 'javascript:alert(1)', 1)],
    },
    {
      name: 'component binding :onclick',
      markdown: '::callout{:onclick="page.script"}\nbody\n::',
      disallowed: [marker('disallowed-attribute', 'callout[onclick]', 1)],
    },
    {
      name: 'component innerHTML prop',
      markdown: '::callout{innerHTML="<img src=x onerror=alert(1)>"}\nbody\n::',
      disallowed: [marker('disallowed-attribute', 'callout[innerHTML]', 1)],
    },
    {
      name: 'component prop with a quote and a tag, which the renderer escapes',
      markdown: "::callout{title='\"><script>alert(1)</script>'}\nbody\n::",
      disallowed: [],
    },
    {
      name: 'component named script',
      markdown: '::script\nalert(1)\n::',
      disallowed: [marker('unknown-component', 'script', 1)],
    },
    {
      name: 'inline component named script',
      markdown: 'x :script[alert(1)] y',
      disallowed: [marker('unknown-component', 'script', 1)],
    },
    {
      name: 'component named iframe',
      markdown: '::iframe{src="https://evil.example/x"}\n::',
      disallowed: [marker('unknown-component', 'iframe', 1)],
    },
    {
      name: 'component named like a marker',
      markdown: '::hollware-marker{kind="raw-html" name="x"}\n::',
      disallowed: [marker('unknown-component', 'hollware-marker', 1)],
    },
    {
      name: 'a colon that is not a component, and one that is',
      markdown: 'a:b and 10:30 and :smile: and :warning',
      disallowed: [
        marker('unknown-component', 'smile', 1),
        marker('unknown-component', 'warning', 1),
      ],
    },
    {
      name: 'html entities and escapes, which are text',
      markdown: '&lt;script&gt;alert(1)&lt;/script&gt; and \\<script>alert(1)\\</script>',
      disallowed: [],
    },
    {
      name: 'code, which holds any text',
      markdown: '`<script>alert(1)</script>`\n\n```html\n<img src=x onerror=alert(1)>\n```',
      disallowed: [],
    },
  ]

  it.each(ATTACKS)('$name', async ({ markdown, components, disallowed }) => {
    const options = components === undefined ? BLOG_OPTIONS : { ...BLOG_OPTIONS, components }
    const { document, extracted } = await accepted(markdown, options)
    expect(extracted.disallowed).toStrictEqual(disallowed)
    const html = await renderHtml(document)
    expect(unsafeThingsIn(html)).toStrictEqual([])
    expect(html).not.toContain('<script')
  })
})

describe('what the document is when a URL is not allowed', () => {
  it('keeps the link text and the image alt, and takes off the URL', async () => {
    const { document } = await accepted(contentFixture('hostile/unsafe-url.md'))
    expect(document.nodes).toStrictEqual([
      [
        'p',
        {},
        'A ',
        ['a', {}, 'script link'],
        ', a ',
        ['a', {}, 'VBScript one'],
        ' and an image ',
        ['img', { alt: 'x' }],
        '.',
      ],
    ])
  })

  it('does not list a link or an image whose URL was taken off', async () => {
    const { extracted } = await accepted(contentFixture('hostile/unsafe-url.md'))
    expect(extracted.links).toStrictEqual([])
    expect(extracted.images).toStrictEqual([])
  })

  it('allows http, https and mailto on links, and relative URLs everywhere', async () => {
    const { extracted } = await accepted(
      '[a](http://a.example/) [b](https://b.example/) [c](mailto:c@d.example) [d](/path) [e](rel) [f](#top) [g](?q=1) [h](//cdn.example/x)\n\n![i](https://i.example/i.png) ![j](/i.png) ![k](k.png)',
    )
    expect(extracted.disallowed).toStrictEqual([])
    expect(extracted.links.map((link) => link.href)).toStrictEqual([
      'http://a.example/',
      'https://b.example/',
      'mailto:c@d.example',
      '/path',
      'rel',
      '#top',
      '?q=1',
      '//cdn.example/x',
    ])
    expect(extracted.images.map((image) => image.src)).toStrictEqual([
      'https://i.example/i.png',
      '/i.png',
      'k.png',
    ])
  })
})

describe('the YAML block of a component', () => {
  it('is not read: the lines stay in the body and give the component no props', async () => {
    const { document, extracted } = await accepted(
      [
        '::callout{type="tip"}',
        '---',
        'a: &a [x]',
        'b: &b [*a,*a,*a,*a,*a,*a,*a,*a,*a]',
        'c: &c [*b,*b,*b,*b,*b,*b,*b,*b,*b]',
        'd: &d [*c,*c,*c,*c,*c,*c,*c,*c,*c]',
        'e: &e [*d,*d,*d,*d,*d,*d,*d,*d,*d]',
        '---',
        'body',
        '::',
      ].join('\n'),
    )
    expect(extracted.components).toStrictEqual([
      { name: 'callout', props: { type: 'tip' }, line: 1 },
    ])
    expect(document.nodes[0]?.[0]).toBe('callout')
    expect(JSON.stringify(document.nodes)).toContain('["hr",{}]')
  })
})

describe('a document that is too deep to store', () => {
  const nested = (pairs: number) => '*a '.repeat(pairs) + 'a* '.repeat(pairs)

  it('is accepted down to 49 levels, with the paragraph that holds them, and every word', async () => {
    const { extracted } = await accepted(nested(48))
    expect(extracted.words).toBe(96)
  })

  it('is refused one level deeper, where Comark would drop the words, with a fix', async () => {
    expect(await refused(nested(49))).toStrictEqual([
      {
        contract: 'comark-parse',
        severity: 'error',
        path: '/body',
        message: 'The document nests elements more than 49 levels deep.',
        fix: 'Flatten the nesting of emphasis, lists, quotes and components.',
        code: 'comark-parse.nesting',
        params: {},
      },
    ])
  })

  it('is refused when it is so deep that Comark itself gives up', async () => {
    const violations = await refused(nested(20_000))
    expect(violations).toHaveLength(1)
    expect(violations[0]?.contract).toBe('comark-parse')
    expect(violations[0]?.fix.length).toBeGreaterThan(20)
  })

  it('is refused for a prop that holds a JSON value nested more than 100 levels, and accepted at 100', async () => {
    const data = (levels: number) =>
      `::callout{data='${'['.repeat(levels)}${']'.repeat(levels)}'}\nx\n::`
    expect((await accepted(data(100))).extracted.components[0]?.name).toBe('callout')
    expect(await refused(data(101))).toStrictEqual([
      {
        contract: 'comark-parse',
        severity: 'error',
        path: '/body',
        message:
          'A component prop holds a value that nests more than 100 levels deep or is not JSON.',
        fix: 'Give the component a smaller, flatter value, written as JSON.',
        code: 'comark-parse.props',
        params: {},
      },
    ])
  })

  it('is refused for a prop that holds a number JSON cannot store', async () => {
    const violations = await refused("::callout{data='[1e999]'}\nx\n::")
    expect(violations[0]?.message).toBe(
      'A component prop holds a value that nests more than 100 levels deep or is not JSON.',
    )
  })
})

describe('what a file holds when nothing is hostile', () => {
  it('has no marker in a post with a heading, a link, a list, a table and a code block', async () => {
    const { extracted } = await accepted(
      file(
        '# A post\n\nText with a [link](/en/blog/x/), **bold** and `code`.\n\n- one\n- two\n\n| a | b |\n|---|---|\n| 1 | 2 |\n\n```ts\nconst a = 1\n```',
      ),
    )
    expect(extracted.disallowed).toStrictEqual([])
  })
})
