// The spike's version of the planned `processMarkdown()` / `renderHtml()`: parse once with Comark,
// derive everything else from the document. API names were read from
//   node_modules/comark/dist/{index,parse,render,types}.d.ts and utils/index.d.ts
//   node_modules/@comark/html/dist/{index,render}.d.ts
import type { ElementNode, MarkdownDocument, Node, NodeHandler } from 'comark'
import { createMarkdownParser } from 'comark'
import { textContent, visit } from 'comark/utils'
import { renderHtmlFromDocument } from '@comark/html'
import { COMARK_VERSION } from './versions.ts'

export type { MarkdownDocument } from 'comark'

/** Tags that Markdown itself produces (plus the slot wrapper `template`). Anything else is a component. */
export const NATIVE_TAGS: ReadonlySet<string> = new Set([
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

export interface Heading {
  depth: number
  text: string
  id: string
}
export interface Link {
  href: string
  text: string
  /** `internal` = relative or same-origin, `anchor` = `#...`, `external` = another origin or scheme. */
  kind: 'internal' | 'anchor' | 'external'
}
export interface Image {
  src: string
  /** `null` when the document has no alt at all: an empty `![](x)` and a missing alt look the same. */
  alt: string | null
  title: string | null
}
export interface ComponentUsage {
  name: string
  props: Record<string, unknown>
}
export interface Extracted {
  headings: Heading[]
  links: Link[]
  images: Image[]
  components: ComponentUsage[]
  words: number
}
export interface Processed {
  comarkVersion: string
  document: MarkdownDocument
  extracted: Extracted
}

// One parser per isolate. `parseMarkdown()` from comark builds a new parser (a new markdown-exit
// instance and every plugin) on each call, so the pipeline keeps its own.
const parser = createMarkdownParser()

export async function parseDocument(markdown: string): Promise<MarkdownDocument> {
  return parser(markdown)
}

function isElement(node: Node): node is ElementNode {
  return Array.isArray(node) && node[0] !== null
}

/** Comark stores boolean and JSON props under a `:`-prefixed key (`{open}` is `":open": "true"`). */
function normalizeProps(attrs: ElementNode[1]): Record<string, unknown> {
  const props: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(attrs)) {
    if (!key.startsWith(':')) {
      props[key] = value
      continue
    }
    // `":open": "true"`, `":count": "3"`; a value that is not JSON stays the string it was.
    if (typeof value !== 'string') {
      props[key.slice(1)] = value
      continue
    }
    try {
      props[key.slice(1)] = JSON.parse(value)
    } catch {
      props[key.slice(1)] = value
    }
  }
  return props
}

function classify(href: string, siteOrigin: string): Link['kind'] {
  if (href.startsWith('#')) return 'anchor'
  try {
    return new URL(href, siteOrigin).origin === new URL(siteOrigin).origin ? 'internal' : 'external'
  } catch {
    return 'external'
  }
}

function stringProp(attrs: ElementNode[1], key: string): string | null {
  const value = attrs[key]
  return typeof value === 'string' ? value : null
}

/** Everything the plan wants to extract, read from the document alone (no second parse). */
export function extract(
  document: MarkdownDocument,
  siteOrigin = 'https://site.example',
): Extracted {
  const headings: Heading[] = []
  const links: Link[] = []
  const images: Image[] = []
  const components: ComponentUsage[] = []

  visit(document, isElement, (node) => {
    if (!isElement(node)) return
    const [tag, attrs] = node
    if (/^h[1-6]$/.test(tag)) {
      headings.push({
        depth: Number(tag.slice(1)),
        text: textContent(node),
        id: stringProp(attrs, 'id') ?? '',
      })
    } else if (tag === 'a') {
      const href = stringProp(attrs, 'href')
      if (href !== null)
        links.push({ href, text: textContent(node), kind: classify(href, siteOrigin) })
    } else if (tag === 'img') {
      images.push({
        src: stringProp(attrs, 'src') ?? '',
        alt: stringProp(attrs, 'alt'),
        title: stringProp(attrs, 'title'),
      })
    } else if (!NATIVE_TAGS.has(tag) && attrs.$?.html !== 1) {
      components.push({ name: tag, props: normalizeProps(attrs) })
    }
  })

  const text = document.nodes.map((node) => textContent(node)).join(' ')
  return { headings, links, images, components, words: text.split(/\s+/).filter(Boolean).length }
}

/** Parse once, derive the rest. The `document` is what would be stored next to the Markdown. */
export async function processMarkdown(markdown: string): Promise<Processed> {
  const document = await parseDocument(markdown)
  return { comarkVersion: COMARK_VERSION, document, extracted: extract(document) }
}

/** Render a document (parsed now, or revived from JSON) to HTML without parsing again. */
export async function renderDocument(
  document: MarkdownDocument,
  components?: Record<string, NodeHandler>,
): Promise<string> {
  return renderHtmlFromDocument(document, components ? { components } : undefined)
}
