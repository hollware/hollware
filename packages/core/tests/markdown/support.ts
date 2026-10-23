import { beforeAll, expect, vi } from 'vite-plus/test'

import { processMarkdown } from '../../src/markdown/process.ts'
import { renderHtml } from '../../src/markdown/render.ts'
import type { ProcessedMarkdown, ProcessMarkdownOptions } from '../../src/markdown/types.ts'

export const BOM = String.fromCharCode(0xfeff)
export const NO_BREAK_SPACE = String.fromCharCode(0xa0)
export const IDEOGRAPHIC_SPACE = String.fromCharCode(0x3000)
export const LINE_SEPARATOR = String.fromCharCode(0x2028)
export const PARAGRAPH_SEPARATOR = String.fromCharCode(0x2029)

export const BLOG_OPTIONS: ProcessMarkdownOptions = {
  components: ['callout', 'youtube'],
  maxMarkdownBytes: 512 * 1024,
  routes: { blog: { es: '/blog/:slug/', en: '/en/blog/:slug/' } },
}

export function warmUpComark(): void {
  vi.setConfig({ testTimeout: 60_000 })
  beforeAll(async () => {
    await processMarkdown('warm up', BLOG_OPTIONS)
    await renderHtml({ frontmatter: {}, meta: {}, nodes: [] })
  }, 120_000)
}

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

export async function refused(markdown: string, options: ProcessMarkdownOptions = BLOG_OPTIONS) {
  const result = await processMarkdown(markdown, options)
  if (result.ok) {
    throw new Error(`accepted: ${JSON.stringify(result.value.extracted)}`)
  }
  return result.violations
}

export function file(body: string, frontmatter = 'title: A post'): string {
  return `---\n${frontmatter}\n---\n\n${body}`
}

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

export function expectNoActiveContent(html: string): void {
  expect(html).not.toContain('<script')
  expect(html).not.toContain('onerror')
  expect(html).not.toContain('javascript:')
  expect(html).not.toContain('<iframe')
  expect(unsafeThingsIn(html)).toStrictEqual([])
}

export function tagsOf(nodes: readonly unknown[]): string[] {
  const tags: string[] = []
  for (const node of nodes) {
    if (Array.isArray(node) && typeof node[0] === 'string') {
      tags.push(node[0], ...tagsOf(node.slice(2)))
    }
  }
  return tags
}
