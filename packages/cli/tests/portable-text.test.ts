import { describe, expect, it } from 'vite-plus/test'

import { portableTextToMarkdown } from '../src/import/portable-text.ts'

// Fails when: an import from EmDash (src/import/portable-text.ts) stops writing a Portable Text
// block as its Markdown: a paragraph, a heading, a quote, a list numbered or nested, strong, em,
// code, strike, a link from its mark definition, a code block with its language, an image with its
// alt; stops escaping what Markdown would read as markup; or invents a form for a block it does not
// know instead of naming it in `skipped`.

const span = (value: string, marks: string[] = []) => ({ _type: 'span', text: value, marks })
const block = (children: object[], extra: object = {}) => ({
  _type: 'block',
  style: 'normal',
  children,
  markDefs: [],
  ...extra,
})

describe('portableTextToMarkdown', () => {
  it('writes each block as its Markdown, with marks and links', () => {
    const { markdown, skipped } = portableTextToMarkdown([
      block([span('Edge caching')], { style: 'h2' }),
      block(
        [
          span('Pages stay '),
          span('at the edge', ['strong']),
          span(', with '),
          span('Cache-Tag', ['code']),
          span(' and '),
          span('a purge', ['em', 'lnk']),
          span(', not '),
          span('a TTL', ['strike-through']),
          span('.'),
        ],
        { markDefs: [{ _key: 'lnk', _type: 'link', href: 'https://example.com/purge' }] },
      ),
      block([span('Quoted.')], { style: 'blockquote' }),
      { _type: 'code', language: 'ts', code: 'const a = 1' },
      { _type: 'image', url: 'https://example.com/a.png', alt: 'A diagram' },
    ])

    expect(markdown).toBe(
      [
        '## Edge caching',
        '',
        'Pages stay **at the edge**, with `Cache-Tag` and [*a purge*](https://example.com/purge), not ~~a TTL~~.',
        '',
        '> Quoted.',
        '',
        '```ts',
        'const a = 1',
        '```',
        '',
        '![A diagram](https://example.com/a.png)',
        '',
      ].join('\n'),
    )
    expect(skipped).toEqual([])
  })

  it('writes lists as one block, numbered and nested, and escapes markup in text', () => {
    const { markdown } = portableTextToMarkdown([
      block([span('First')], { listItem: 'number', level: 1 }),
      block([span('Inside')], { listItem: 'bullet', level: 2 }),
      block([span('Second')], { listItem: 'number', level: 1 }),
      block([span('Not *bold* or # a heading')]),
    ])

    expect(markdown).toBe(
      ['1. First', '  - Inside', '2. Second', '', 'Not \\*bold\\* or \\# a heading', ''].join('\n'),
    )
  })

  it('leaves out a block it has no form for, and names its type once', () => {
    const { markdown, skipped } = portableTextToMarkdown([
      block([span('Kept.')]),
      { _type: 'callToAction', label: 'Buy' },
      { _type: 'callToAction', label: 'Again' },
      { _type: 'image', alt: 'No URL' },
    ])

    expect(markdown).toBe('Kept.\n')
    expect(skipped).toEqual(['callToAction', 'image'])
  })
})
