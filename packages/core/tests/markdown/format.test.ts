import { describe, expect, it } from 'vite-plus/test'

import { CONTENT_FIXTURES, contentFixture } from '../../../../tests/fixtures/content.ts'
import {
  canonicalMarkdown,
  formatMarkdown,
  parseForEditing,
  stringifyBody,
} from '../../src/markdown/format.ts'
import { processMarkdown } from '../../src/markdown/process.ts'
import { BLOG_OPTIONS, warmUpComark } from './support.ts'

warmUpComark()

const COMARK_CASES: readonly string[] = [
  '::card{title="A"}\nOuter\n\n:::note\nInner **b**\n:::\n\n#footer\nFoot\n::\n',
  'A [link](/x){target="_blank"} and **b**{.big} and :badge[New]{color="red"}\n',
  '> [!WARNING]\n> Careful *now*.\n',
  '- [ ] one\n- [x] two\n',
  '| a | b |\n|:--|--:|\n| 1 | 2 |\n',
  'Text <span class="x">raw</span>\n\n<div>\nblock\n</div>\n',
  '````md\n```js\nx\n```\n````\n',
  'line one  \nline two\\\nthree\n',
  '![alt](asset:ast_123 "Title") ![](https://x.example/a.png)\n',
  '- a\n  - b\n    1. c\n- d\n\n  para in item\n',
  '::callout{type="info" :count="5"}\nHi\n::\n',
]

describe('the canonical Markdown', () => {
  it('is the one style of Comark, whatever style the file was written in', async () => {
    expect(
      await canonicalMarkdown(
        '---\r\ntitle: Hi\r\ndate: 2026-10-15\r\n---\r\n\r\nSome _em_ and __strong__.\r\n\r\n* a\r\n* b\r\n\r\nTitle\r\n===\r\n',
      ),
    ).toBe(
      '---\ntitle: Hi\ndate: 2026-10-15\n---\n\nSome *em* and **strong**.\n\n- a\n- b\n\n# Title\n',
    )
  })

  it('drops a byte order mark, inlines references and fences code that holds backticks', async () => {
    expect(
      await canonicalMarkdown(
        `${String.fromCodePoint(0xfeff)}See [x][ref] and \`a \`\` b\`.\n\n[ref]: https://example.com\n`,
      ),
    ).toBe('See [x](https://example.com) and ```a `` b```.\n')
  })

  it('leaves a file whose frontmatter does not parse as it is', async () => {
    const broken = '---\ntitle: [an unclosed list\n---\n\nBody\n'
    expect(await canonicalMarkdown(broken)).toBe(broken)
  })

  it('writes a body back from its document, which is how the editor saves', async () => {
    expect(await stringifyBody(await parseForEditing('Some _em_.\n\n* a\n'))).toBe(
      'Some *em*.\n\n- a\n',
    )
  })
})

describe('formatting a write', () => {
  const sources = [...CONTENT_FIXTURES.map((fixture) => fixture.markdown), ...COMARK_CASES]

  it('stores what was written in a form that formatting again leaves as it is', async () => {
    for (const source of sources) {
      const once = await formatMarkdown(source, BLOG_OPTIONS)
      const twice = await formatMarkdown(once.markdown, BLOG_OPTIONS)
      expect(twice.markdown, source).toBe(once.markdown)
    }
  })

  it('never changes what a reader gets', async () => {
    for (const source of sources) {
      const formatted = await formatMarkdown(source, BLOG_OPTIONS)
      const original = await processMarkdown(source, BLOG_OPTIONS)
      expect(formatted.processed.ok, source).toBe(original.ok)
      if (formatted.processed.ok && original.ok) {
        expect(formatted.processed.value.document, source).toEqual(original.value.document)
        expect(formatted.processed.value.frontmatter, source).toEqual(original.value.frontmatter)
      }
    }
  })

  it('formats the corpus of the blog, so a person and an agent write the same bytes', async () => {
    const post = contentFixture('blog/en/markdown-as-source-of-truth.md')
    const { markdown } = await formatMarkdown(post, BLOG_OPTIONS)
    expect(markdown).not.toBe(post)
    expect(markdown).toBe(post.replace('_predictable_', '*predictable*'))
  })

  it('keeps the text as written when formatting it again would change it again', async () => {
    const unstable = '}word ]({# '
    const once = await canonicalMarkdown(unstable)
    expect(once).toBe('}word \\]( {#}\n')
    expect(await canonicalMarkdown(once)).toBe('}word \\]( {#}}\n')
    expect((await formatMarkdown(unstable, BLOG_OPTIONS)).markdown).toBe(unstable)
  })

  it('writes the bytes the editor writes', async () => {
    for (const source of sources) {
      const { markdown } = await formatMarkdown(source, BLOG_OPTIONS)
      if (markdown !== source) expect(markdown, source).toBe(await canonicalMarkdown(source))
    }
  })

  it('keeps the text as written when Hollware leaves part of it out, and says so', async () => {
    const options = { ...BLOG_OPTIONS, components: ['card', 'badge'] }
    const tail = await formatMarkdown('::card{a="1"} junk\nx\n::\n', options)
    expect(tail.markdown).toBe('::card{a="1"} junk\nx\n::\n')
    expect(tail.processed.ok && tail.processed.value.extracted.disallowed).toEqual([
      { kind: 'disallowed-attribute', name: 'card[junk]', line: 1 },
    ])
    const braces = 'Text with {braces} and :badge[x]{color="red"}\n'
    expect((await formatMarkdown(braces, options)).markdown).toBe(braces)
    expect((await formatMarkdown('A [l](/x){ target="_blank" } and *b*\n', options)).markdown).toBe(
      'A [l](/x){target="_blank"} and *b*\n',
    )
  })

  it('keeps the text as written when its canonical form would mean something else', async () => {
    const odd = ' => [!NOTE]\n{<?x ?>'
    expect(await canonicalMarkdown(odd)).toBe('=> [!NOTE]\n')
    expect((await formatMarkdown(odd, BLOG_OPTIONS)).markdown).toBe(odd)
  })
})
