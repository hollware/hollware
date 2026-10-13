import { describe, expect, it } from 'vite-plus/test'

import { CONTENT_FIXTURES } from '../../../../tests/fixtures/content.ts'
import { processMarkdown } from '../../src/markdown/process.ts'
import { renderHtml } from '../../src/markdown/render.ts'
import { getParser } from '../../src/markdown/parser.ts'
import { accepted, BLOG_OPTIONS, tagsOf, warmUpComark } from './support.ts'

// Fails when: the same Markdown gives another document, other extracted data or another HTML a
// second time (the pipeline keeps something between two calls, or the order of what it finds
// depends on the order of the keys of the config); two writes at the same time disturb each other
// (the parser or the analysis shares a variable between calls); the parser is built again for
// every call or for every set of components (src/markdown/parser.ts `getParser`); a document is
// not plain JSON that reads back as it is, or keeps something the analysis should have taken off
// (`$line`, `$open`, a `$` of raw HTML), or holds a tag that is neither Markdown's, a
// component's nor a marker.

warmUpComark()

const NATIVE = new Set([
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
])
const ALLOWED_TAGS = new Set([...NATIVE, 'callout', 'youtube', 'hollware-marker'])

/** Every key of every props object in the nodes of a document. */
function propKeys(nodes: readonly unknown[]): string[] {
  const keys: string[] = []
  for (const node of nodes) {
    if (Array.isArray(node)) {
      keys.push(...Object.keys(node[1] ?? {}), ...propKeys(node.slice(2)))
    }
  }
  return keys
}

describe('the same Markdown', () => {
  it('gives the same result twice, for every fixture, the refused ones included', async () => {
    for (const fixture of CONTENT_FIXTURES) {
      const first = JSON.stringify(await processMarkdown(fixture.markdown, BLOG_OPTIONS))
      const second = JSON.stringify(await processMarkdown(fixture.markdown, BLOG_OPTIONS))
      expect(second, fixture.path).toBe(first)
    }
  })

  it('gives what it gave, whatever order the components and the routes are given in', async () => {
    const reversed = {
      ...BLOG_OPTIONS,
      components: [...BLOG_OPTIONS.components].reverse(),
      routes: { blog: { en: '/en/blog/:slug/', es: '/blog/:slug/' } },
    }
    for (const fixture of CONTENT_FIXTURES) {
      const one = JSON.stringify(await processMarkdown(fixture.markdown, BLOG_OPTIONS))
      const other = JSON.stringify(await processMarkdown(fixture.markdown, reversed))
      expect(other, fixture.path).toBe(one)
    }
  })

  it('does not depend on what was processed before, nor on a result being changed by its caller', async () => {
    const markdown = '# Title\n\nSome [link](/en/blog/x/) text.'
    const first = await accepted(markdown)
    const before = JSON.stringify(first)
    first.document.nodes.length = 0
    first.document.frontmatter.title = 'changed by the caller'
    await accepted('::callout\nother\n::\n\n<b>x</b>')
    expect(JSON.stringify(await accepted(markdown))).toBe(before)
  })

  it('gives the same results when many files are processed at the same time', async () => {
    const files = CONTENT_FIXTURES.map((fixture) => fixture.markdown)
    const alone = []
    for (const markdown of files)
      alone.push(JSON.stringify(await processMarkdown(markdown, BLOG_OPTIONS)))
    const together = await Promise.all(
      files.map((markdown) => processMarkdown(markdown, BLOG_OPTIONS)),
    )
    expect(together.map((result) => JSON.stringify(result))).toStrictEqual(alone)
    const twice = await Promise.all(
      [...files, ...files].map((markdown) => processMarkdown(markdown, BLOG_OPTIONS)),
    )
    expect(twice.map((result) => JSON.stringify(result))).toStrictEqual([...alone, ...alone])
  })

  it('renders to the same HTML twice', async () => {
    for (const fixture of CONTENT_FIXTURES) {
      const result = await processMarkdown(fixture.markdown, BLOG_OPTIONS)
      if (!result.ok) continue
      const { document } = result.value
      expect(await renderHtml(document), fixture.path).toBe(await renderHtml(document))
    }
  })
})

describe('the document', () => {
  it('is plain JSON that reads back as it is, with the three keys Comark gives it and an empty meta', async () => {
    for (const fixture of CONTENT_FIXTURES) {
      const result = await processMarkdown(fixture.markdown, BLOG_OPTIONS)
      if (!result.ok) continue
      const { document, extracted, frontmatter } = result.value
      expect(Object.keys(document), fixture.path).toStrictEqual(['frontmatter', 'meta', 'nodes'])
      expect(document.meta, fixture.path).toStrictEqual({})
      expect(document.frontmatter, fixture.path).toBe(frontmatter)
      expect(JSON.parse(JSON.stringify(document)), fixture.path).toStrictEqual(document)
      expect(JSON.parse(JSON.stringify(extracted)), fixture.path).toStrictEqual(extracted)
    }
  })

  it('holds no key of the analysis, and only tags that are Markdown, a component or a marker', async () => {
    for (const fixture of CONTENT_FIXTURES) {
      const result = await processMarkdown(fixture.markdown, BLOG_OPTIONS)
      if (!result.ok) continue
      const { nodes } = result.value.document
      expect(
        propKeys(nodes).filter((key) => key.startsWith('$')),
        fixture.path,
      ).toStrictEqual([])
      expect(
        tagsOf(nodes).filter((tag) => !ALLOWED_TAGS.has(tag)),
        fixture.path,
      ).toStrictEqual([])
    }
  })

  it('holds no prop that is an event handler, and no href or src that runs code', async () => {
    for (const fixture of CONTENT_FIXTURES) {
      const result = await processMarkdown(fixture.markdown, BLOG_OPTIONS)
      if (!result.ok) continue
      const text = JSON.stringify(result.value.document.nodes)
      expect(text, fixture.path).not.toMatch(/"on[a-z]+":/i)
      expect(text, fixture.path).not.toMatch(/"(?:href|src)":"\s*(?:javascript|vbscript|data):/i)
    }
  })
})

describe('the parser', () => {
  it('is one for the isolate: asking again, or at the same time, gives the one that was built', async () => {
    const first = await getParser()
    expect(await getParser()).toBe(first)
    const [one, two] = await Promise.all([getParser(), getParser()])
    expect(one).toBe(first)
    expect(two).toBe(first)
  })

  it('does not depend on the components of a collection, which the analysis checks afterwards', async () => {
    const first = await getParser()
    await processMarkdown('::callout\nx\n::', { ...BLOG_OPTIONS, components: ['callout'] })
    await processMarkdown('::other\nx\n::', { ...BLOG_OPTIONS, components: ['other', 'another'] })
    await processMarkdown('::callout\nx\n::', { ...BLOG_OPTIONS, components: [] })
    expect(await getParser()).toBe(first)
  })
})
