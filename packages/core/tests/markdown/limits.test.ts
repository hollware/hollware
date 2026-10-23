import { describe, expect, it } from 'vite-plus/test'

import { contentFixture } from '../../../../tests/fixtures/content.ts'
import { processMarkdown } from '../../src/markdown/process.ts'
import {
  accepted,
  BLOG_OPTIONS,
  BOM,
  file,
  LINE_SEPARATOR,
  PARAGRAPH_SEPARATOR,
  refused,
  warmUpComark,
} from './support.ts'

warmUpComark()

const limit = (maxMarkdownBytes: number) => ({ ...BLOG_OPTIONS, maxMarkdownBytes })

describe('the size limit', () => {
  it('accepts a file of exactly the limit and refuses one byte more, with a fix', async () => {
    expect((await accepted('a'.repeat(10), limit(10))).extracted.words).toBe(1)
    expect(await refused('a'.repeat(11), limit(10))).toStrictEqual([
      {
        contract: 'size-limit',
        severity: 'error',
        path: '/body',
        message: 'The Markdown file is 11 bytes and this collection accepts at most 10.',
        fix: 'Shorten the file to 10 bytes or fewer, counting the frontmatter, or split the content into several entries.',
      },
    ])
  })

  it('counts UTF-8 bytes: two for é, three for 日, four for an emoji, three for a lone surrogate', async () => {
    for (const [text, bytes] of [
      ['é'.repeat(5), 10],
      ['日'.repeat(3), 9],
      ['😀', 4],
      ['\ud800', 3],
      ['\ud800a', 4],
      ['a😀b', 6],
    ] as const) {
      expect((await processMarkdown(text, limit(bytes))).ok).toBe(true)
      const over = await refused(text, limit(bytes - 1))
      expect(over[0]?.message).toBe(
        `The Markdown file is ${bytes} bytes and this collection accepts at most ${bytes - 1}.`,
      )
    }
  })

  it('counts the whole file, the frontmatter and the byte order mark included', async () => {
    expect((await processMarkdown(BOM + 'ab', limit(5))).ok).toBe(true)
    expect((await refused(BOM + 'ab', limit(4)))[0]?.message).toBe(
      'The Markdown file is 5 bytes and this collection accepts at most 4.',
    )
    const withFrontmatter = file('x', 'title: T')
    expect(withFrontmatter).toHaveLength(19)
    expect((await processMarkdown(withFrontmatter, limit(19))).ok).toBe(true)
    expect(await refused(withFrontmatter, limit(18))).toHaveLength(1)
  })

  it('refuses a file when the limit is not a number, instead of letting it through', async () => {
    const violations = await refused('a', limit(Number.NaN))
    expect(violations[0]?.contract).toBe('size-limit')
    expect(violations[0]?.message).toBe(
      'The Markdown file is 1 bytes and this collection accepts at most NaN.',
    )
  })

  it('checks the size before it parses, so a file over the limit never reaches Comark', async () => {
    const violations = await refused('---\ntitle: [oops\n---\n' + 'a'.repeat(100), limit(50))
    expect(violations.map((violation) => violation.contract)).toStrictEqual(['size-limit'])
  })
})

describe('the byte order mark', () => {
  it('is removed, so that the frontmatter of the fixture is read', async () => {
    const markdown = contentFixture('hostile/bom.md')
    expect(markdown.charCodeAt(0)).toBe(0xfeff)
    const { frontmatter, document } = await accepted(markdown)
    expect(frontmatter).toStrictEqual({
      title: 'A hostile post',
      description: 'A post whose body holds something the pipeline must not let through.',
      date: '2026-10-01',
      tags: ['cms'],
      translationGroup: 'hostile',
    })
    expect(JSON.stringify(document.nodes)).toBe(
      '[["p",{},"A file that starts with a byte order mark."]]',
    )
  })

  it('does not move the lines', async () => {
    const plain = await accepted(file('# Title'))
    const marked = await accepted(BOM + file('# Title'))
    expect(plain.extracted.headings[0]?.line).toBe(5)
    expect(marked.extracted.headings[0]?.line).toBe(5)
  })

  it('is the only thing in a file that has nothing else', async () => {
    const { document, extracted } = await accepted(BOM)
    expect(document).toStrictEqual({ frontmatter: {}, meta: {}, nodes: [] })
    expect(extracted).toStrictEqual({
      headings: [],
      links: [],
      images: [],
      components: [],
      words: 0,
      codeWords: 0,
      disallowed: [],
    })
  })
})

describe('input of any shape', () => {
  it('answers for a value that is not a string with a violation, never an exception', async () => {
    for (const value of [undefined, null, 42, {}, ['# a']]) {
      const result = await Reflect.apply(processMarkdown, undefined, [value, BLOG_OPTIONS])
      expect(result).toStrictEqual({
        ok: false,
        violations: [
          {
            contract: 'comark-parse',
            severity: 'error',
            path: '/body',
            message: 'The Markdown is not a string.',
            fix: 'Send the whole file, frontmatter and body, as one string.',
          },
        ],
      })
    }
  })

  it('answers for every odd string, and what it accepts is JSON that reads back as it is', async () => {
    const strings = [
      '',
      '\n',
      '\r',
      '\r\n\r\n',
      '\u0000',
      '\ud800',
      '\udc00 lone low surrogate',
      'line' + LINE_SEPARATOR + 'separator' + PARAGRAPH_SEPARATOR,
      BOM + BOM,
      '---',
      '---\n---',
      '::',
      ':::::',
      '{',
      '{{',
      '[',
      '[]',
      '<',
      '</',
      '<!',
      '<!--',
      '&',
      '&#;',
      '&#xZZ;',
      '\\',
      '```',
      '~~~',
      '#'.repeat(10),
      'a'.repeat(100_000),
      '\n'.repeat(2000),
    ]
    for (const markdown of strings) {
      const result = await processMarkdown(markdown, BLOG_OPTIONS)
      expect(typeof result.ok).toBe('boolean')
      if (result.ok) {
        const { document, extracted } = result.value
        expect(JSON.parse(JSON.stringify(document))).toStrictEqual(document)
        expect(JSON.parse(JSON.stringify(extracted))).toStrictEqual(extracted)
      } else {
        expect(result.violations.length).toBeGreaterThan(0)
      }
    }
  })
})
