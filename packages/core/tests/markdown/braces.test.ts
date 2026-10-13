import { describe, expect, it } from 'vite-plus/test'

import { accepted, BLOG_OPTIONS, tagsOf, warmUpComark } from './support.ts'

// Fails when: text that Comark's syntax takes and leaves out of the document is dropped without a
// word again. Comark reads every `{...}` as attributes and keeps them only where an element takes
// them as its own, so `Use {id} here` came out as `Use  here`, an unclosed `{` took the rest of
// its paragraph, and `::callout{type="tip"} and this` lost `and this`. The markdown-it rule in
// src/markdown/parser.ts (`rewriteTokens`, `keepPropsText`, `openTail`) lists each of them in a
// node at the end of the document, and `analyzeDocument` (src/markdown/analyze.ts: `takeLeftOut`,
// `takeProps` and the loop after the walk) reports the ones that no element took, the ones that
// were not attributes at all, and the tails, once each, on their line.

warmUpComark()

const OPTIONS = { ...BLOG_OPTIONS, components: ['callout', 'badge'] }

/** What was reported, as `[name, line]`. */
async function reported(markdown: string): Promise<[string, number | undefined][]> {
  const { extracted } = await accepted(markdown, OPTIONS)
  expect(
    extracted.disallowed.every((item) => item.kind === 'disallowed-attribute'),
    markdown,
  ).toBe(true)
  return extracted.disallowed.map((item) => [item.name, item.line])
}

describe('braces in prose', () => {
  it.each([
    [
      'one in the middle of a line',
      'Use {x} here and {a=b} there',
      [
        ['p[{x}]', 1],
        ['p[{a=b}]', 1],
      ],
    ],
    [
      'a set, a JSON object and a condition',
      'Set {a, b, c} = 3 and {"k": "v"} and f(x) = {x | x > 0}.',
      [
        ['p[{a, b, c}]', 1],
        ['p[{"k": "v"}]', 1],
        ['p[{x | x > 0}]', 1],
      ],
    ],
    ['a block of CSS', 'CSS: body { color: red; } and more text.', [['p[{ color: red; }]', 1]]],
    [
      'a price',
      'Price is {$5} or {5}',
      [
        ['p[{$5}]', 1],
        ['p[{5}]', 1],
      ],
    ],
    ['a heading', '# Heading {a} and more', [['h1[{a}]', 1]]],
    [
      'table cells',
      '| a {x} | b |\n|---|---|\n| c | d {y} |',
      [
        ['th[{x}]', 1],
        ['td[{y}]', 3],
      ],
    ],
    [
      'link text, where an image alt keeps its own',
      '[a {x}](/u) and ![alt {y}](/i.png)',
      [['p[{x}]', 1]],
    ],
    ['the text between two words', 'a{x}b', [['p[{x}]', 1]]],
    ['a brace that is alone', '{', [['p[{]', 1]]],
    [
      'braces after emphasis that hold no attribute',
      '**b**{"a": 1} and `code`{.c}',
      [
        ['code[class]', 1],
        ['p[{"a": 1}]', 1],
      ],
    ],
    ['the second line of a paragraph', 'line one\nline two {x} here\nline three', [['p[{x}]', 2]]],
    ['the second item of a list', '- item\n- item two {y} more', [['p[{y}]', 2]]],
  ] as const)('are reported when %s', async (_name, markdown, found) => {
    expect(await reported(markdown)).toStrictEqual(found)
  })

  it('leave the document as Comark makes it, so that what was lost is what the report names', async () => {
    const { document } = await accepted('Use {x} here and {a=b} there', OPTIONS)
    expect(document.nodes).toStrictEqual([['p', {}, 'Use  here and  there']])
  })

  it('are reported on the line where the element that took them starts, when one took them', async () => {
    // The `{y}` at the end of the paragraph is an attribute of the paragraph: Comark keeps it as one.
    expect(await reported('line one\nline two {x} here\nline three {y}')).toStrictEqual([
      ['p[y]', 1],
      ['p[{x}]', 2],
    ])
  })

  it('are reported for the words of an unclosed one, which Comark makes attributes of the paragraph', async () => {
    const { document, extracted } = await accepted('Start {a b', OPTIONS)
    expect(extracted.disallowed.map((item) => item.name)).toStrictEqual(['p[a]', 'p[b]'])
    expect(document.nodes).toStrictEqual([['p', {}, 'Start']])
  })
})

describe('braces that an element takes as attributes', () => {
  it.each([
    ['at the end of a paragraph', 'Use {x}', [['p[x]', 1]]],
    ['on a heading', '# Heading {#id}', [['h1[id]', 1]]],
    ['on a link', '[x](/a){onclick="y"}', [['a[onclick]', 1]]],
  ] as const)(
    'are judged with the element, and reported once, %s',
    async (_name, markdown, found) => {
      expect(await reported(markdown)).toStrictEqual(found)
    },
  )

  it.each([
    ['an image width and height', '![i](/x.png){width=10 height=5}'],
    ['the props of an inline component', ':badge[x]{tone="a"} and :badge{tone="b"}'],
    ['the props of a block component', '::callout{type="tip"}\ncontent\n::'],
  ])('are not reported when they are %s', async (_name, markdown) => {
    expect(await reported(markdown)).toStrictEqual([])
  })
})

describe('braces that are text', () => {
  it('are text: escaped, doubled, after a dollar, in code and in a code block', async () => {
    const markdown = ['\\{x} and {{ y }} and $' + '{z} and `{w}`', '', '```', '{q}', '```'].join(
      '\n',
    )
    const { document, extracted } = await accepted(markdown, OPTIONS)
    expect(extracted.disallowed).toStrictEqual([])
    expect(document.nodes).toStrictEqual([
      ['p', {}, '{x} and {{ y }} and $' + '{z} and ', ['code', {}, '{w}']],
      ['pre', {}, ['code', {}, '{q}']],
    ])
  })
})

describe('text after the parameters of the line that opens a component', () => {
  it.each([
    [
      'after the props',
      '::callout{type="tip"} trailing words\nbody\n::',
      [['callout[trailing words]', 1]],
    ],
    ['after the name', '::callout trailing words\nbody\n::', [['callout[trailing words]', 1]]],
    [
      'after the content and the props',
      '::callout[inline text]{type="tip"} extra\n',
      [['callout[extra]', 1]],
    ],
    ['after a second set of props', '::callout{a="1"}{b="2"}\nbody\n::', [['callout[{b="2"}]', 1]]],
    [
      'after props that hold a brace in a string',
      '::callout{title="a } b"} tail\nx\n::',
      [['callout[tail]', 1]],
    ],
    [
      'after props that hold an escaped quote',
      '::callout{a="\\"}"} tail\nx\n::',
      [['callout[tail]', 1]],
    ],
    [
      'after props that hold braces inside braces',
      `::callout{data='{"a": {"b": 1}}'} tail`,
      [['callout[tail]', 1]],
    ],
    [
      'after the content with brackets in it',
      '::callout[a [b] c]{x="1"} tail\nbody\n::',
      [['callout[tail]', 1]],
    ],
    ['in a quote', '> ::callout{type="tip"} tail\n> body\n> ::', [['callout[tail]', 1]]],
    ['in a list', '- ::callout tail\n  body\n  ::', [['callout[tail]', 1]]],
    ['on the third line of the file', 'a\n\n::callout tail\nbody\n::', [['callout[tail]', 3]]],
    [
      'of a component inside a component',
      '::callout{type="tip"}\n:::callout trailing\nnested\n:::\n::',
      [['callout[trailing]', 2]],
    ],
  ] as const)('is reported %s', async (_name, markdown, found) => {
    expect(await reported(markdown)).toStrictEqual(found)
  })

  it('is not reported where there is none: spaces, brackets and props in any gaps, an odd value', async () => {
    for (const markdown of [
      '::callout{type="tip"}   \nbody\n::',
      '::callout\n::',
      '::callout{type="tip"}\n  indented body\n::',
      '::callout [x]  {type="tip"}  \nbody\n::',
      '::callout{a=b"c}\nx\n::',
    ]) {
      expect(await reported(markdown), markdown).toStrictEqual([])
    }
  })

  it('leaves the component as Comark makes it, without the text that the report names', async () => {
    const { document } = await accepted('::callout{type="tip"} trailing words\nbody\n::', OPTIONS)
    expect(document.nodes).toStrictEqual([['callout', { type: 'tip' }, 'body']])
  })
})

describe('the list of what was left out', () => {
  it('is never in the document, and neither is a key of it', async () => {
    const { document } = await accepted('Use {x} and {y}.\n\n::callout tail\nz\n::', OPTIONS)
    expect(tagsOf(document.nodes).filter((tag) => tag.includes(':'))).toStrictEqual([])
    expect(JSON.stringify(document)).not.toContain('$p')
  })
})
