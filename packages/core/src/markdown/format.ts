import type { ElementNode, MarkdownDocument } from 'comark'
import { getFormatParser } from './parser.ts'
import { processMarkdown } from './process.ts'
import type { ProcessedMarkdown, ProcessMarkdownOptions, ProcessResult } from './types.ts'

export interface FormattedMarkdown {
  readonly markdown: string
  readonly processed: ProcessResult
}

interface Formatter {
  readonly body: (document: MarkdownDocument) => Promise<string>
  readonly file: (document: MarkdownDocument) => Promise<string>
}

let formatter: Promise<Formatter> | undefined

function inlineCode(node: ElementNode): string {
  let content = ''
  for (const child of node.slice(2)) if (typeof child === 'string') content += child
  const longest = Math.max(0, ...(content.match(/`+/g) ?? []).map((run) => run.length))
  const fence = '`'.repeat(longest + 1)
  const pad = content.startsWith('`') || content.endsWith('`') ? ' ' : ''
  return `${fence}${pad}${content}${pad}${fence}`
}

async function createFormatter(): Promise<Formatter> {
  const [render, yaml] = await Promise.all([import('comark/render'), import('js-yaml')])
  const components = { code: inlineCode }
  const ending = (text: string) => (text === '' ? '' : `${text}\n`)
  return {
    body: async (document) =>
      ending((await render.render(document, { format: 'markdown/comark', components })).trim()),
    file: async (document) =>
      ending(
        await render.renderMarkdown(document, {
          components,
          frontmatterOptions: { schema: yaml.JSON_SCHEMA },
        }),
      ),
  }
}

function getFormatter(): Promise<Formatter> {
  formatter ??= createFormatter().catch((error: unknown) => {
    formatter = undefined
    throw error
  })
  return formatter
}

const BYTE_ORDER_MARK = String.fromCodePoint(0xfeff)

function withoutMark(text: string): string {
  return text.startsWith(BYTE_ORDER_MARK) ? text.slice(1) : text
}

export async function parseForEditing(body: string): Promise<MarkdownDocument> {
  const parser = await getFormatParser()
  return parser.parseBody(withoutMark(body))
}

export async function stringifyBody(document: MarkdownDocument): Promise<string> {
  return (await getFormatter()).body(document)
}

export async function canonicalMarkdown(markdown: string): Promise<string> {
  const parser = await getFormatParser()
  let split: { content: string; data: unknown }
  try {
    split = parser.splitFrontmatter(withoutMark(markdown))
  } catch {
    return markdown
  }
  if (typeof split.data !== 'object' || split.data === null || Array.isArray(split.data)) {
    return markdown
  }
  const document = await parser.parseBody(split.content)
  document.frontmatter = { ...split.data }
  return (await getFormatter()).file(document)
}

function withoutLines(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(withoutLines)
  if (typeof value !== 'object' || value === null) return value
  return Object.fromEntries(
    Object.entries(value)
      .filter(([key]) => key !== 'line')
      .map(([key, inner]) => [key, withoutLines(inner)]),
  )
}

function sameMeaning(a: ProcessedMarkdown, b: ProcessedMarkdown): boolean {
  const meaning = (processed: ProcessedMarkdown) =>
    JSON.stringify(withoutLines([processed.frontmatter, processed.document, processed.extracted]))
  return meaning(a) === meaning(b)
}

export async function formatMarkdown(
  markdown: string,
  options: ProcessMarkdownOptions,
): Promise<FormattedMarkdown> {
  const processed = await processMarkdown(markdown, options)
  if (!processed.ok) return { markdown, processed }
  const canonical = await canonicalMarkdown(markdown)
  if (canonical === markdown) return { markdown, processed }
  const reprocessed = await processMarkdown(canonical, options)
  if (
    !reprocessed.ok ||
    !sameMeaning(processed.value, reprocessed.value) ||
    (await canonicalMarkdown(canonical)) !== canonical
  ) {
    return { markdown, processed }
  }
  return { markdown: canonical, processed: reprocessed }
}
