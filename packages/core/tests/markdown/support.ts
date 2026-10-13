import { beforeAll, expect, vi } from 'vite-plus/test'

import { processMarkdown } from '../../src/markdown/process.ts'
import { renderHtml } from '../../src/markdown/render.ts'
import type { ProcessedMarkdown, ProcessMarkdownOptions } from '../../src/markdown/types.ts'

/** Characters that an editor, a formatter or a terminal shows as nothing, or turns into something else. */
export const BOM = String.fromCharCode(0xfeff)
export const NO_BREAK_SPACE = String.fromCharCode(0xa0)
export const IDEOGRAPHIC_SPACE = String.fromCharCode(0x3000)
export const LINE_SEPARATOR = String.fromCharCode(0x2028)
export const PARAGRAPH_SEPARATOR = String.fromCharCode(0x2029)

/** The options of the playground's blog (`apps/playground/hollware.config.ts`). */
export const BLOG_OPTIONS: ProcessMarkdownOptions = {
  components: ['callout', 'youtube'],
  maxMarkdownBytes: 512 * 1024,
  routes: { blog: { es: '/blog/:slug/', en: '/en/blog/:slug/' } },
}

/**
 * Prepares a test file that uses the pipeline. It loads Comark and `@comark/html` before the first
 * test: inside workerd that takes seconds, because Vite fetches and transforms the modules of both
 * one by one, and the first test would otherwise run into the five seconds a test has. It also
 * gives every test of the file a minute, since the machine that runs them in CI may be busy, and
 * the files that go through many Markdown files (the fuzz test, the fingerprints) take their time
 * in workerd, whose engine is slower than Node's here.
 */
export function warmUpComark(): void {
  vi.setConfig({ testTimeout: 60_000 })
  beforeAll(async () => {
    await processMarkdown('warm up', BLOG_OPTIONS)
    await renderHtml({ frontmatter: {}, meta: {}, nodes: [] })
  }, 120_000)
}

/** Processes Markdown that must be accepted and gives what the pipeline found in it. */
export async function accepted(
  markdown: string,
  options: ProcessMarkdownOptions = BLOG_OPTIONS,
): Promise<ProcessedMarkdown> {
  const result = await processMarkdown(markdown, options)
  if (!result.ok) {
    throw new Error(`refused: ${JSON.stringify(result.violations)}`)
  }
  return result.value
}

/** Processes Markdown that must be refused and gives the violations. */
export async function refused(markdown: string, options: ProcessMarkdownOptions = BLOG_OPTIONS) {
  const result = await processMarkdown(markdown, options)
  if (result.ok) {
    throw new Error(`accepted: ${JSON.stringify(result.value.extracted)}`)
  }
  return result.violations
}

/** The Markdown of a file with this frontmatter and body. */
export function file(body: string, frontmatter = 'title: A post'): string {
  return `---\n${frontmatter}\n---\n\n${body}`
}

/**
 * What the HTML of an entry must never hold: a tag that runs or loads something, an event handler,
 * an unsafe URL. The quoted value of an attribute is text, and may say `onerror=` without being one.
 */
export function unsafeThingsIn(html: string): string[] {
  const found: string[] = []
  const tags = html.match(/<[a-zA-Z][^>]*>/g) ?? []
  for (const tag of tags) {
    if (/^<(?:script|style|iframe|frame|object|embed|svg|math|form|meta|link|base)\b/i.test(tag)) {
      found.push(`the tag ${tag}`)
    }
    if (/\son[a-z]+\s*=/i.test(tag.replace(/"[^"]*"/g, '""'))) found.push(`a handler in ${tag}`)
    if (
      /\b(?:href|src|action|formaction|poster)\s*=\s*"\s*(?:javascript|vbscript|data):/i.test(tag)
    ) {
      found.push(`an unsafe URL in ${tag}`)
    }
  }
  return found
}

/** The HTML of the fixtures must not hold these, whatever the tag or the attribute. */
export function expectNoActiveContent(html: string): void {
  expect(html).not.toContain('<script')
  expect(html).not.toContain('onerror')
  expect(html).not.toContain('javascript:')
  expect(html).not.toContain('<iframe')
  expect(unsafeThingsIn(html)).toStrictEqual([])
}

/** Every tag in the nodes of a document, in order, text left out. */
export function tagsOf(nodes: readonly unknown[]): string[] {
  const tags: string[] = []
  for (const node of nodes) {
    if (Array.isArray(node) && typeof node[0] === 'string') {
      tags.push(node[0], ...tagsOf(node.slice(2)))
    }
  }
  return tags
}
