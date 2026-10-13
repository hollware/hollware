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

/*
 * Rendering a stored document. The pipeline already keeps raw HTML, event handlers and
 * unsafe URLs out of what it stores, but `@comark/html` prints whatever it is handed: a
 * `script` element, an `onclick` prop, a comment that closes itself and opens a script, an
 * `href` with a character reference that the browser reads as `javascript:`. So the document is
 * copied through the rules below first, and the HTML is safe for any document, not only for the
 * ones this pipeline wrote.
 */

type Props = Record<string, unknown>

/** HTML elements that load, run or restyle something, or change how the HTML after them is read. */
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

/** A tag name that is safe to print: letters, digits and a few separators, starting with a letter. */
const TAG_NAME = /^[A-Za-z][\w.-]{0,63}$/

/** The attributes that hold a URL, by the name `attributeName` gives them. */
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

function sanitizeProps(raw: unknown): Props {
  const props: Props = {}
  if (!isProps(raw)) return props
  for (const key of Object.keys(raw)) {
    // Keys that start with `$` are Comark's and the pipeline's own. `$` carries what Comark knows of
    // an element that came from raw HTML, and the renderer prints the text of such an element
    // without escaping it.
    if (key.startsWith('$')) continue
    const name = attributeName(key)
    if (isForbiddenAttribute(name)) continue
    const value = raw[key]
    if (URL_ATTRIBUTES.has(name)) {
      const url = urlValue(key, value)
      if (url === undefined || !isSafeUrl(url, name === 'src' ? 'image' : 'link')) continue
    }
    // The renderer leaves `&#106;` in an attribute as it is, and a browser reads it as `j`: say `&` once, as `&amp;`.
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

function sanitizeElement(node: readonly unknown[], depth: number): ElementNode | undefined {
  const tag: unknown = node[0]
  // A comment node, or anything else that is not an element, is not printed.
  if (typeof tag !== 'string') return undefined
  if (!NATIVE_TAGS.has(tag) && tag !== MARKER_TAG) {
    if (!TAG_NAME.test(tag) || DANGEROUS_TAGS.has(tag.toLowerCase())) return marker(tag)
  }
  const element: ElementNode = [tag, sanitizeProps(node[1])]
  if (depth >= MAX_DEPTH) return element
  for (let at = 2; at < node.length; at++) {
    const child = node[at]
    if (typeof child === 'string') {
      element.push(child)
    } else if (Array.isArray(child)) {
      const clean = sanitizeElement(child, depth + 1)
      if (clean !== undefined) element.push(clean)
    }
  }
  return element
}

/** Copies a document through the rules of this file. */
function sanitizeDocument(document: EntryDocument): MarkdownDocument {
  const nodes: MarkdownDocument['nodes'] = []
  if (Array.isArray(document.nodes)) {
    for (const node of document.nodes) {
      if (typeof node === 'string') {
        nodes.push(node)
      } else if (Array.isArray(node)) {
        const clean = sanitizeElement(node, 1)
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
  return renderHtmlFromDocument(sanitizeDocument(document))
}
