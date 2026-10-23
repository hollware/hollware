import type { ElementNode, MarkdownDocument } from 'comark'
import {
  MARKER_TAG,
  MAX_DEPTH,
  NATIVE_TAGS,
  attributeName,
  isBinding,
  isForbiddenAttribute,
  isSafeUrl,
  setOwn,
  shorten,
  urlValue,
} from './policy.ts'
import type { EntryDocument, RenderHtml } from './types.ts'

type Props = Record<string, unknown>

const DANGEROUS_TAGS: ReadonlySet<string> = new Set([
  'script',
  'style',
  'iframe',
  'frame',
  'frameset',
  'object',
  'embed',
  'applet',
  'base',
  'link',
  'meta',
  'form',
  'svg',
  'math',
  'noscript',
  'noembed',
  'noframes',
  'xmp',
  'plaintext',
  'listing',
  'textarea',
  'title',
  'select',
  'option',
  'button',
  'audio',
  'video',
  'source',
  'track',
  'picture',
  'canvas',
  'portal',
  'dialog',
  'slot',
  'html',
  'head',
  'body',
  'param',
  'bgsound',
  'image',
])

const TAG_NAME = /^[A-Za-z][\w.-]{0,63}$/

const URL_ATTRIBUTES: ReadonlySet<string> = new Set([
  'href',
  'xlinkhref',
  'src',
  'action',
  'poster',
  'background',
  'cite',
  'ping',
])

function isProps(value: unknown): value is Props {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

type DocumentData = Readonly<Record<string, unknown>>

function resolvePath(data: DocumentData, path: string): unknown {
  let value: unknown = data
  for (const part of path.split('.')) {
    if (typeof value !== 'object' || value === null || !Object.hasOwn(value, part)) return undefined
    value = Reflect.get(value, part)
  }
  return value
}

function unbound(key: string): string {
  return key.startsWith('v-bind:') ? key.slice('v-bind:'.length) : key.replace(/^:/, '')
}

function sanitizeProps(raw: unknown, data: DocumentData): Props {
  const props: Props = {}
  if (!isProps(raw)) return props
  for (const key of Object.keys(raw)) {
    if (key.startsWith('$')) continue
    const name = attributeName(key)
    if (isForbiddenAttribute(name)) continue
    const value = raw[key]
    if (URL_ATTRIBUTES.has(name)) {
      const kind = name === 'src' ? 'image' : 'link'
      const url = urlValue(key, value)
      if (url === undefined) continue
      if (isBinding(key) && url === value) {
        const bound = resolvePath(data, url)
        if (typeof bound === 'string' && isSafeUrl(bound, kind)) {
          setOwn(props, unbound(key), bound.replaceAll('&', '&amp;'))
        }
        continue
      }
      if (!isSafeUrl(url, kind)) continue
    }
    setOwn(
      props,
      key,
      typeof value === 'string' && !isBinding(key) ? value.replaceAll('&', '&amp;') : value,
    )
  }
  return props
}

function marker(name: string): ElementNode {
  return [MARKER_TAG, { kind: 'raw-html', name: TAG_NAME.test(name) ? shorten(name) : '?' }]
}

function sanitizeElement(
  node: readonly unknown[],
  depth: number,
  data: DocumentData,
): ElementNode | undefined {
  const tag: unknown = node[0]
  if (typeof tag !== 'string') return undefined
  if (!NATIVE_TAGS.has(tag) && tag !== MARKER_TAG) {
    if (!TAG_NAME.test(tag) || DANGEROUS_TAGS.has(tag.toLowerCase())) return marker(tag)
  }
  const element: ElementNode = [tag, sanitizeProps(node[1], data)]
  if (depth >= MAX_DEPTH) return element
  for (let at = 2; at < node.length; at++) {
    const child = node[at]
    if (typeof child === 'string') {
      element.push(child)
    } else if (Array.isArray(child)) {
      const clean = sanitizeElement(child, depth + 1, data)
      if (clean !== undefined) element.push(clean)
    }
  }
  return element
}

/**
 * Copies a document through the rules of this file: what a renderer of a site's own (an Astro
 * component, say) renders, so that it is as safe as the HTML Hollware makes. A raw HTML element
 * the pipeline marked stays a `hollware-marker` element, which a renderer leaves out.
 */
export function safeDocument(document: EntryDocument): MarkdownDocument {
  const nodes: MarkdownDocument['nodes'] = []
  const data: DocumentData = { frontmatter: document.frontmatter, meta: document.meta }
  if (Array.isArray(document.nodes)) {
    for (const node of document.nodes) {
      if (typeof node === 'string') {
        nodes.push(node)
      } else if (Array.isArray(node)) {
        const clean = sanitizeElement(node, 1, data)
        if (clean !== undefined) nodes.push(clean)
      }
    }
  }
  return { frontmatter: document.frontmatter, meta: document.meta, nodes }
}

/**
 * Renders a stored document to HTML with `@comark/html`. `@comark/html` is imported when the
 * first document is rendered, so that an isolate that never renders never loads it.
 */
export const renderHtml: RenderHtml = async (document) => {
  const { renderHtmlFromDocument } = await import('@comark/html')
  return renderHtmlFromDocument(safeDocument(document))
}
