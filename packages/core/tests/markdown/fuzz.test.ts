import { describe, expect, it } from 'vite-plus/test'

import { processMarkdown } from '../../src/markdown/process.ts'
import { renderHtml } from '../../src/markdown/render.ts'
import {
  BLOG_OPTIONS,
  BOM,
  LINE_SEPARATOR,
  tagsOf,
  unsafeThingsIn,
  warmUpComark,
} from './support.ts'

warmUpComark()

function generator(seed: number): () => number {
  let state = seed >>> 0
  return () => {
    state = (state + 0x6d2b79f5) >>> 0
    let t = state
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const PIECES = [
  '# ',
  '## ',
  '### ',
  '\n',
  '\n\n',
  '\n\n\n',
  ' ',
  '  ',
  '    ',
  '\t',
  'word ',
  'Hello ',
  'Diseño ',
  'é',
  '日本',
  '😀',
  '**',
  '*',
  '_',
  '__',
  '~~',
  '`',
  '``',
  '```',
  '```ts\n',
  '~~~',
  '[',
  ']',
  '(',
  ')',
  '](',
  '!',
  '![',
  '<',
  '>',
  '</',
  '/>',
  '<b>',
  '</b>',
  '<script>alert(1)</script>',
  '<img src=x onerror=alert(1)>',
  '<!-- c -->',
  '<?x ?>',
  '<div>',
  '<iframe srcdoc="x">',
  '&lt;',
  '&#106;',
  '&#x6A;',
  '&',
  '&;',
  '\\',
  ':',
  '::',
  ':::',
  '{',
  '}',
  '{.cls}',
  '{#id}',
  '{open}',
  '{onclick="x"}',
  '{href="javascript:alert(1)"}',
  '{:href="page.url"}',
  '::callout{type="tip"}',
  '::youtube{id="dQw4w9WgXcQ"}',
  '::youtub{id="x"}',
  ':badge[x]',
  ':smile:',
  '#slot\n',
  '---',
  '- ',
  '* ',
  '1. ',
  '> ',
  '> [!NOTE]\n',
  '- [ ] ',
  '| a | b |\n',
  '|---|---|\n',
  '[x](javascript:alert(1))',
  '![i](data:image/png;base64,AA)',
  '<javascript:alert(1)>',
  'javascript:',
  'vbscript:',
  'data:text/html,',
  'http://example.com',
  '/en/blog/x/',
  '/blog/y/',
  '<https://example.com>',
  '[x][r]',
  '[r]: /ref "T"',
  '*a '.repeat(110),
  'a* '.repeat(110),
  '{x}',
  '{a, b}',
  '{"k": 1}',
  '{ color: red; }',
  '::callout{type="tip"} tail\n',
  '\r\n',
  '\r',
  LINE_SEPARATOR,
  '\u0000',
  '\ud800',
  BOM,
  '=',
  '+',
  '~',
]

const COMPONENTS = new Set(['callout', 'youtube'])
const ALLOWED_TAGS = new Set([
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
  'p',
  'a',
  'img',
  'ul',
  'ol',
  'li',
  'pre',
  'code',
  'table',
  'thead',
  'tbody',
  'tr',
  'th',
  'td',
  'blockquote',
  'hr',
  'br',
  'strong',
  'em',
  'del',
  'span',
  'input',
  'template',
  'hollware-marker',
  ...COMPONENTS,
])

function pieces(next: () => number, count: number): string {
  let text = ''
  for (let piece = 0; piece < count; piece++) {
    text += PIECES[Math.floor(next() * PIECES.length)] ?? ''
  }
  return text
}

function fileFrom(next: () => number): string {
  const kind = next()
  const frontmatter =
    kind < 0.2
      ? '---\ntitle: Fuzz\n---\n\n'
      : kind < 0.35
        ? `---\n${pieces(next, 1 + Math.floor(next() * 6))}\n---\n\n`
        : ''
  return frontmatter + pieces(next, 1 + Math.floor(next() * 40))
}

function lineBreaks(text: string): number {
  return (text.match(/\r\n?|\n/g) ?? []).length
}

describe('files made of pieces of Markdown, HTML and hostile text', () => {
  it('are all answered, and every answer holds to what the pipeline promises', async () => {
    const next = generator(20261012)
    let accepted = 0
    let refused = 0
    for (let attempt = 0; attempt < 700; attempt++) {
      const markdown = fileFrom(next)
      const result = await processMarkdown(markdown, BLOG_OPTIONS)
      const label = `file ${attempt}: ${JSON.stringify(markdown)}`
      if (!result.ok) {
        refused++
        expect(result.violations.length, label).toBeGreaterThan(0)
        for (const violation of result.violations) {
          expect(['size-limit', 'frontmatter-syntax', 'comark-parse'], label).toContain(
            violation.contract,
          )
          expect(['/body', '/frontmatter'], label).toContain(violation.path)
          expect(violation.fix.length, label).toBeGreaterThan(10)
          expect(violation.message.length, label).toBeGreaterThan(10)
        }
        continue
      }
      accepted++
      const { document, extracted } = result.value
      const stored = JSON.stringify(document)
      expect(JSON.parse(stored), label).toStrictEqual(document)
      expect(
        tagsOf(document.nodes).filter((tag) => !ALLOWED_TAGS.has(tag)),
        label,
      ).toStrictEqual([])
      expect(stored, label).not.toMatch(/"\$[a-z0-9]*":/)
      expect(stored, label).not.toMatch(/"on[a-z]+":/i)
      expect(stored, label).not.toMatch(/"(?:href|src)":"\s*(?:javascript|vbscript|data):/i)
      const ids = extracted.headings.map((heading) => heading.id)
      expect(new Set(ids).size, label).toBe(ids.length)
      expect(
        ids.every((id) => id !== ''),
        label,
      ).toBe(true)
      expect(Number.isInteger(extracted.words) && extracted.words >= 0, label).toBe(true)
      const last = lineBreaks(markdown) + 1
      const lines = [
        ...extracted.headings.map((item) => item.line),
        ...extracted.links.map((item) => item.line),
        ...extracted.images.map((item) => item.line),
        ...extracted.components.map((item) => item.line),
        ...extracted.disallowed.map((item) => item.line),
      ]
      for (const line of lines) {
        expect(
          Number.isInteger(line) && (line ?? 0) >= 1 && (line ?? 0) <= last,
          `${label} line ${line}`,
        ).toBe(true)
      }
      const html = await renderHtml(document)
      expect(unsafeThingsIn(html), label).toStrictEqual([])
    }
    expect(accepted).toBeGreaterThan(300)
    expect(refused).toBeGreaterThan(0)
  })

  it('give the same answer the second time', async () => {
    const next = generator(7)
    for (let attempt = 0; attempt < 150; attempt++) {
      const markdown = fileFrom(next)
      const first = JSON.stringify(await processMarkdown(markdown, BLOG_OPTIONS))
      expect(
        JSON.stringify(await processMarkdown(markdown, BLOG_OPTIONS)),
        JSON.stringify(markdown),
      ).toBe(first)
    }
  })
})
