import type { ElementNode, ElementNodeAttributes, MarkdownDocument, Node } from 'comark'
import { getFormatParser } from './parser.ts'
import { LEFT_OUT_TAG, LINE_KEY, OPEN_KEY, PROPS_KEY } from './policy.ts'
import { finishMarkdown, readMarkdown, type ReadMarkdown } from './process.ts'
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

interface Written {
  readonly nodes: Node[]
  readonly meaning: string
}

function plainProps(props: ElementNodeAttributes): ElementNodeAttributes {
  const plain: ElementNodeAttributes = {}
  for (const [key, value] of Object.entries(props)) {
    if (key !== LINE_KEY && key !== OPEN_KEY && !PROPS_KEY.test(key)) plain[key] = value
  }
  return plain
}

function plainNode(node: Node): Node {
  if (typeof node === 'string' || node[0] === null) return node
  const [tag, props, ...children] = node
  return [tag, plainProps(props), ...children.map(plainNode)]
}

function written(read: ReadMarkdown): Written {
  const all = read.document.nodes
  const last = all.at(-1)
  const leftOut =
    last !== undefined && typeof last !== 'string' && last[0] === LEFT_OUT_TAG
      ? Object.keys(last[1]).length
      : 0
  const nodes = all.slice(0, leftOut > 0 ? -1 : all.length).map(plainNode)
  return { nodes, meaning: JSON.stringify([nodes, leftOut]) }
}

export async function formatMarkdown(
  markdown: string,
  options: ProcessMarkdownOptions,
): Promise<FormattedMarkdown> {
  const read = await readMarkdown(markdown, options)
  if (!read.ok) return { markdown, processed: read }
  const plain = written(read.value)
  const canonical = await (
    await getFormatter()
  ).file({ frontmatter: read.value.frontmatter, meta: {}, nodes: plain.nodes })
  if (canonical !== markdown) {
    const again = await readMarkdown(canonical, options)
    if (again.ok && written(again.value).meaning === plain.meaning) {
      return { markdown: canonical, processed: finishMarkdown(again.value, options) }
    }
  }
  return { markdown, processed: finishMarkdown(read.value, options) }
}
