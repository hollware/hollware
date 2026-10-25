import type { ElementNode, MarkdownDocument } from 'comark'
import { getFormatParser } from './parser.ts'
import { processMarkdown } from './process.ts'
import type { ProcessMarkdownOptions, ProcessResult } from './types.ts'

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

async function readCanonical(markdown: string): Promise<MarkdownDocument | undefined> {
  const parser = await getFormatParser()
  let split: { content: string; data: unknown }
  try {
    split = parser.splitFrontmatter(withoutMark(markdown))
  } catch {
    return undefined
  }
  if (typeof split.data !== 'object' || split.data === null || Array.isArray(split.data)) {
    return undefined
  }
  const document = await parser.parseBody(split.content)
  document.frontmatter = { ...split.data }
  return document
}

export async function canonicalMarkdown(markdown: string): Promise<string> {
  const document = await readCanonical(markdown)
  return document === undefined ? markdown : (await getFormatter()).file(document)
}

export async function formatMarkdown(
  markdown: string,
  options: ProcessMarkdownOptions,
): Promise<FormattedMarkdown> {
  const document = await readCanonical(markdown)
  if (document === undefined)
    return { markdown, processed: await processMarkdown(markdown, options) }
  const tree = JSON.stringify(document)
  const canonical = await (await getFormatter()).file(document)
  if (canonical === markdown)
    return { markdown, processed: await processMarkdown(markdown, options) }
  const again = await readCanonical(canonical)
  if (again === undefined || JSON.stringify(again) !== tree) {
    return { markdown, processed: await processMarkdown(markdown, options) }
  }
  const processed = await processMarkdown(canonical, options)
  if (processed.ok) return { markdown: canonical, processed }
  return { markdown, processed: await processMarkdown(markdown, options) }
}
