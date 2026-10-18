import type { MarkdownDocument } from 'comark'
import { describe, expect, it } from 'vite-plus/test'

import { analyzeDocument } from '../../src/markdown/analyze.ts'
import { compileRoutes } from '../../src/markdown/routes.ts'

// Fails when: the analysis (src/markdown/analyze.ts) trusts a document more than the Markdown it
// came from can make it: it lets through a node that is not an element or text (a comment), a
// forged `hollware-raw:` or `hollware-marker` element, a line that is not a number of the file, a
// prop that is not an object, a tree deeper than MAX_DEPTH or a prop value deeper than that, or
// an own `__proto__` key; or it forgets what it takes off a node (the line keys, the attributes
// outside the allowlist) or what it gives back (the brackets of a span, the id of a heading).

/** A document with these nodes, which no Markdown wrote: the analysis has to judge it all the same. */
function documentOf(...nodes: unknown[]): MarkdownDocument {
  return JSON.parse(JSON.stringify({ frontmatter: {}, meta: {}, nodes }))
}

const OPTIONS = {
  components: new Set(['callout', 'badge']),
  routes: compileRoutes({ blog: { en: '/en/blog/:slug/' } }),
  lineOffset: 0,
}

describe('a document that no Markdown wrote', () => {
  it('turns a comment node into a marker, since only raw HTML makes one', () => {
    const document = documentOf([
      'p',
      {},
      'before',
      [null, {}, ' --><script>alert(1)</script><!-- '],
      'after',
    ])
    const { extracted } = analyzeDocument(document, OPTIONS)
    expect(document.nodes).toStrictEqual([
      ['p', {}, 'before', ['hollware-marker', { kind: 'raw-html', name: '!--', line: 1 }], 'after'],
    ])
    expect(extracted.disallowed).toStrictEqual([{ kind: 'raw-html', name: '!--', line: 1 }])
  })

  it('turns a raw HTML element and an element named like a marker into markers', () => {
    const document = documentOf(
      ['hollware-raw:script', {}],
      ['hollware-marker', { kind: 'raw-html', name: 'script' }, 'kept'],
      ['hollware-raw:iframe', { $line: '4' }],
    )
    const { extracted } = analyzeDocument(document, OPTIONS)
    expect(document.nodes).toStrictEqual([
      ['hollware-marker', { kind: 'raw-html', name: 'script', line: 1 }],
      ['hollware-marker', { kind: 'unknown-component', name: 'hollware-marker', line: 1 }, 'kept'],
      ['hollware-marker', { kind: 'raw-html', name: 'iframe', line: 5 }],
    ])
    expect(extracted.disallowed).toStrictEqual([
      { kind: 'raw-html', name: 'script', line: 1 },
      { kind: 'unknown-component', name: 'hollware-marker', line: 1 },
      { kind: 'raw-html', name: 'iframe', line: 5 },
    ])
  })

  it('does not stumble on nodes that are neither text nor elements, and fixes a missing props object', () => {
    const document: MarkdownDocument = {
      frontmatter: {},
      meta: {},
      nodes: JSON.parse(
        '[5, null, {"a":1}, ["p"], ["p", "text", "one two"], ["strong", null, "three"]]',
      ),
    }
    const { extracted } = analyzeDocument(document, OPTIONS)
    expect(extracted.words).toBe(3)
    expect(document.nodes).toStrictEqual([
      5,
      null,
      { a: 1 },
      ['p', {}],
      ['p', {}, 'one two'],
      ['strong', {}, 'three'],
    ])
  })

  it('takes the lines the markdown-it rule leaves, and only if they are numbers', () => {
    const document = documentOf(
      ['h1', { $line: '0' }, 'a'],
      ['h2', { $line: '7' }, 'b'],
      ['h3', { $line: 'abc' }, 'c'],
      ['h3', { $line: '-1' }, 'd'],
      ['h3', { $line: '1.5' }, 'e'],
      ['h3', { $line: 3 }, 'f'],
      ['callout', { $open: '9', $line: '10' }, ['a', { href: '/en/blog/x/' }, 'g']],
    )
    const { extracted } = analyzeDocument(document, { ...OPTIONS, lineOffset: 4 })
    expect(extracted.headings.map((heading) => [heading.text, heading.line])).toStrictEqual([
      ['a', 5],
      ['b', 12],
      ['c', 12],
      ['d', 12],
      // `1.5` is read as `1`, which is a line; the others are not lines at all.
      ['e', 6],
      ['f', 6],
    ])
    expect(extracted.components).toStrictEqual([{ name: 'callout', props: {}, line: 14 }])
    expect(extracted.links.map((link) => link.line)).toStrictEqual([15])
    expect(JSON.stringify(document.nodes)).not.toContain('$')
  })

  it('refuses a tree deeper than 100 levels and accepts one of exactly 100', () => {
    const nested = (levels: number): unknown => {
      let node: unknown = 'leaf'
      for (let level = 0; level < levels; level++) node = ['em', {}, node]
      return node
    }
    expect(analyzeDocument(documentOf(nested(100)), OPTIONS).problem).toBeUndefined()
    expect(analyzeDocument(documentOf(nested(101)), OPTIONS).problem).toBe('nesting')
  })

  it('refuses a prop that holds a value nested more than 100 levels, or a number JSON cannot hold', () => {
    const levels = (count: number): unknown => {
      let value: unknown = 'leaf'
      for (let level = 0; level < count; level++) value = [value]
      return value
    }
    const withProp = (value: unknown) => documentOf(['callout', { data: value }, 'x'])
    expect(analyzeDocument(withProp(levels(100)), OPTIONS).problem).toBeUndefined()
    expect(analyzeDocument(withProp(levels(101)), OPTIONS).problem).toBe('props')
    const infinite: MarkdownDocument = {
      frontmatter: {},
      meta: {},
      nodes: [['callout', { data: [Number.POSITIVE_INFINITY] }, 'x']],
    }
    expect(analyzeDocument(infinite, OPTIONS).problem).toBe('props')
  })

  it('keeps a prop called __proto__ as a prop of the use, and pollutes nothing', () => {
    const document = documentOf()
    document.nodes.push(
      JSON.parse('["callout", {":__proto__": "{\\"x\\":1}", "__proto__": "y"}, "x"]'),
    )
    const { extracted } = analyzeDocument(document, OPTIONS)
    const props = extracted.components[0]?.props ?? {}
    expect(Object.keys(props)).toStrictEqual(['__proto__'])
    expect(Object.getOwnPropertyDescriptor(props, '__proto__')?.value).toBe('y')
    expect(Object.getPrototypeOf(props)).toBe(Object.prototype)
    expect(Reflect.get(Object.prototype, 'x')).toBeUndefined()
  })
})

describe('the list of what Comark left out, which the markdown-it rule adds to the document', () => {
  /** One entry, as the rule writes it: the line (from 0), the block, whether it was attributes, the text. */
  const entry = (line: string, tag: string, given: string, text: string) =>
    [line, tag, given, text].join('\u0000')

  it('is read from the end of the document and removed, and each entry is reported once, on its line', () => {
    const document = documentOf(
      ['p', { $p0: '1' }, 'taken'],
      ['p', {}, 'x'],
      [
        'hollware-left-out:',
        {
          $p0: entry('0', 'p', '1', '{a}'),
          $p1: entry('2', 'p', '1', '{b}'),
          $p2: entry('3', 'li', '0', '{"c": 1}'),
          $p3: entry('abc', 'p', '0', '{d}'),
          $p4: 'no separators',
          other: entry('1', 'p', '0', '{e}'),
        },
      ],
    )
    const { extracted } = analyzeDocument(document, { ...OPTIONS, lineOffset: 10 })
    expect(document.nodes).toStrictEqual([
      ['p', {}, 'taken'],
      ['p', {}, 'x'],
    ])
    // `{a}` was taken by the first paragraph, so that is judged with it; `{b}` was not.
    expect(extracted.disallowed).toStrictEqual([
      { kind: 'disallowed-attribute', name: 'p[{b}]', line: 13 },
      { kind: 'disallowed-attribute', name: 'li[{"c": 1}]', line: 14 },
    ])
  })

  it('is not read when it is not the last node, where it is an element nobody can write', () => {
    const document = documentOf(
      ['hollware-left-out:', { $p0: entry('0', 'p', '0', '{a}') }],
      ['p', {}, 'x'],
    )
    const { extracted } = analyzeDocument(document, OPTIONS)
    expect(extracted.disallowed).toStrictEqual([
      { kind: 'unknown-component', name: 'hollware-left-out:', line: 1 },
    ])
  })

  it('takes the attribute off an element that is replaced by a marker, and reports what it was for only once', () => {
    const document = documentOf(
      ['unknown', { $p0: '1', tone: 'blue' }, 'x'],
      ['hollware-left-out:', { $p0: entry('0', 'p', '1', '{tone="blue"}') }],
    )
    const { extracted } = analyzeDocument(document, OPTIONS)
    expect(extracted.disallowed).toStrictEqual([
      { kind: 'unknown-component', name: 'unknown', line: 1 },
    ])
    expect(JSON.stringify(document.nodes)).not.toContain('$p')
  })

  it('puts what it reports in the order of the file', () => {
    const document = documentOf(
      ['p', { $line: '4', onclick: 'x' }, 'late'],
      ['p', { $line: '1', onclick: 'y' }, 'early'],
      ['hollware-left-out:', { $p0: entry('2', 'p', '0', '{middle}') }],
    )
    const { extracted } = analyzeDocument(document, OPTIONS)
    expect(extracted.disallowed.map((item) => [item.name, item.line])).toStrictEqual([
      ['p[onclick]', 2],
      ['p[{middle}]', 3],
      ['p[onclick]', 5],
    ])
  })
})

describe('what the analysis takes off and gives back', () => {
  it('gives a span its brackets back, and an empty span too', () => {
    const document = documentOf([
      'p',
      {},
      'array',
      ['span', {}, '0'],
      ' and ',
      ['span', {}, ['strong', {}, 'b']],
      ' and ',
      ['span', {}],
    ])
    analyzeDocument(document, OPTIONS)
    expect(document.nodes).toStrictEqual([
      [
        'p',
        {},
        'array',
        ['span', {}, '[0]'],
        ' and ',
        ['span', {}, '[', ['strong', {}, 'b'], ']'],
        ' and ',
        ['span', {}, '[]'],
      ],
    ])
  })

  it('replaces the id of a heading with its own, and removes the other attributes', () => {
    const document = documentOf(['h2', { id: 'mine', class: 'big', $line: '0' }, 'Título nuevo'])
    const { extracted } = analyzeDocument(document, OPTIONS)
    expect(document.nodes).toStrictEqual([['h2', { id: 'título-nuevo' }, 'Título nuevo']])
    expect(extracted.disallowed).toStrictEqual([
      { kind: 'disallowed-attribute', name: 'h2[id]', line: 1 },
      { kind: 'disallowed-attribute', name: 'h2[class]', line: 1 },
    ])
  })

  it('keeps the attributes that Markdown and Comark put on their own tags', () => {
    const document = documentOf(
      [
        'ul',
        { class: 'contains-task-list' },
        [
          'li',
          { class: 'task-list-item' },
          ['input', { class: 'task-list-item-checkbox', type: 'checkbox', ':disabled': 'true' }],
          ' done',
        ],
      ],
      ['table', {}, ['tbody', {}, ['tr', {}, ['td', { style: 'text-align:center' }, 'x']]]],
      ['blockquote', { as: 'warning' }, 'careful'],
      [
        'pre',
        { language: 'ts', highlights: [1, 2], filename: 'a.ts', meta: 'extra' },
        ['code', { class: 'language-ts' }, 'a'],
      ],
      ['ol', { start: '3' }, ['li', {}, 'three']],
    )
    const before = JSON.stringify(document.nodes)
    const { extracted } = analyzeDocument(document, OPTIONS)
    expect(extracted.disallowed).toStrictEqual([])
    expect(JSON.stringify(document.nodes)).toBe(before)
  })

  it('takes off every attribute a native tag does not allow, saying which and where', () => {
    const document = documentOf([
      'p',
      { $line: '2', style: 'x' },
      ['a', { href: '/x', target: '_blank', rel: 'noopener' }, 'l'],
      ['img', { src: '/i.png', loading: 'lazy' }],
    ])
    const { extracted } = analyzeDocument(document, OPTIONS)
    expect(document.nodes).toStrictEqual([
      ['p', {}, ['a', { href: '/x' }, 'l'], ['img', { src: '/i.png' }]],
    ])
    expect(extracted.disallowed).toStrictEqual([
      { kind: 'disallowed-attribute', name: 'p[style]', line: 3 },
      { kind: 'disallowed-attribute', name: 'a[target]', line: 3 },
      { kind: 'disallowed-attribute', name: 'a[rel]', line: 3 },
      { kind: 'disallowed-attribute', name: 'img[loading]', line: 3 },
    ])
  })

  it('leaves a component every prop that is not unsafe, which its schema judges', () => {
    const document = documentOf([
      'callout',
      {
        type: 'tip',
        class: 'wide',
        style: 'color:red',
        ':open': 'true',
        'data-x': '1',
        onclick: 'x',
        '@click': 'y',
        ':onload': 'z',
        srcdoc: '<p>',
        href: 'javascript:alert(1)',
        src: '/ok.png',
        'xlink:href': 'data:text/html,x',
      },
      'x',
    ])
    const { extracted } = analyzeDocument(document, OPTIONS)
    expect(extracted.components[0]?.props).toStrictEqual({
      type: 'tip',
      class: 'wide',
      style: 'color:red',
      open: true,
      'data-x': '1',
      src: '/ok.png',
    })
    expect(extracted.disallowed.map((item) => [item.kind, item.name])).toStrictEqual([
      ['disallowed-attribute', 'callout[onclick]'],
      ['disallowed-attribute', 'callout[@click]'],
      ['disallowed-attribute', 'callout[onload]'],
      ['disallowed-attribute', 'callout[srcdoc]'],
      ['unsafe-url', 'javascript:alert(1)'],
      ['unsafe-url', 'data:text/html,x'],
    ])
  })

  it('takes the props a site binds to links and images by their name as URLs', () => {
    const document = documentOf([
      'callout',
      {
        to: 'javascript:alert(1)',
        url: 'vbscript:x',
        ctaUrl: 'javascript:alert(2)',
        imageSrc: 'data:text/html,x',
        link: '/docs/',
        title: 'javascript: is only text here',
      },
      'x',
    ])
    const { extracted } = analyzeDocument(document, OPTIONS)
    expect(extracted.components[0]?.props).toStrictEqual({
      link: '/docs/',
      title: 'javascript: is only text here',
    })
    expect(extracted.disallowed.map((item) => [item.kind, item.name])).toStrictEqual([
      ['unsafe-url', 'javascript:alert(1)'],
      ['unsafe-url', 'vbscript:x'],
      ['unsafe-url', 'javascript:alert(2)'],
      ['unsafe-url', 'data:text/html,x'],
    ])
  })

  it('refuses a URL prop that is not text, as the attribute it is', () => {
    const document = documentOf(['callout', { href: { a: 1 }, src: 5 }, 'x'])
    const { extracted } = analyzeDocument(document, OPTIONS)
    expect(extracted.disallowed.map((item) => item.name)).toStrictEqual([
      'callout[href]',
      'callout[src]',
    ])
    expect(extracted.components[0]?.props).toStrictEqual({})
  })

  it('names a long URL by its first hundred characters, each once per line', () => {
    const url = `javascript:${'x'.repeat(200)}`
    const document = documentOf(['p', {}, ['a', { href: url }, 'one'], ['a', { href: url }, 'two']])
    const { extracted } = analyzeDocument(document, OPTIONS)
    expect(extracted.disallowed).toStrictEqual([
      { kind: 'unsafe-url', name: `${url.slice(0, 97)}...`, line: 1 },
    ])
  })

  it('counts words across inline elements and not across blocks, and skips code blocks', () => {
    const document = documentOf(
      ['p', {}, 'a', ['strong', {}, 'b'], 'c d'],
      ['p', {}, 'e'],
      ['pre', {}, ['code', {}, 'not counted at all']],
      ['ul', {}, ['li', {}, 'f'], ['li', {}, 'g']],
    )
    expect(analyzeDocument(document, OPTIONS).extracted.words).toBe(5)
  })
})
