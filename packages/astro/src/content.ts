import { imageOf as imageOfEntry, type ImageAttributes, type PageImage } from '@hollware/client'
import { safeDocument, type EntryDocument } from '@hollware/core'

/*
 * What the components of `@hollware/astro` (components/*.astro) render, apart from them so a test
 * can hold it: the nodes of an entry's document, through the same rules as the HTML Hollware
 * makes, and the `<img>` of an image of its frontmatter.
 */

/** A node of a document: a text, or an element as `[tag, props, ...children]`. */
export type ContentNode = string | readonly unknown[]

/** What an entry of a Hollware collection holds besides its data: its document and images. */
export interface HollwareMetadata {
  readonly document?: unknown
  readonly images?: Readonly<Record<string, PageImage>>
}

/** An entry as `getEntry` or `getLiveEntry` gives it. */
export interface HollwareEntryLike {
  readonly data?: Readonly<Record<string, unknown>>
  readonly rendered?: { readonly metadata?: Readonly<Record<string, unknown>> } | undefined
}

function metadataOf(entry: HollwareEntryLike | null | undefined): HollwareMetadata {
  const metadata = entry?.rendered?.metadata
  return typeof metadata === 'object' && metadata !== null ? metadata : {}
}

function isDocument(value: unknown): value is { nodes: unknown[] } {
  return typeof value === 'object' && value !== null && Array.isArray(Reflect.get(value, 'nodes'))
}

/**
 * The nodes of an entry's document, safe to render: the same rules as the HTML Hollware makes
 * (no element that runs or loads, no handler, no unsafe URL). None when the entry has no document.
 */
export function contentNodes(entry: HollwareEntryLike | null | undefined): ContentNode[] {
  const document = metadataOf(entry).document
  if (!isDocument(document)) return []
  const safe = safeDocument({
    nodes: document.nodes as EntryDocument['nodes'],
    frontmatter: {},
    meta: {},
  })
  const nodes: ContentNode[] = [...safe.nodes]
  return nodes
}

/** The elements that hold no children, which a renderer closes on the spot. */
const VOID = new Set(['img', 'br', 'hr', 'input', 'wbr', 'col', 'area'])

/** An element to render: the site's component or the plain tag, its props, and its children. */
export interface ContentElement {
  /** The site's component for the tag, or the tag itself. */
  readonly tag: unknown
  readonly component: boolean
  readonly props: Record<string, unknown>
  readonly children: ContentNode[]
  readonly empty: boolean
}

const pascal = (tag: string) =>
  tag.replace(/(^|[-_])([a-z0-9])/g, (_match, _sep, letter: string) => letter.toUpperCase())

/**
 * An element of a document as a renderer takes it. A component of the entry (`::callout`) is the
 * site's component of that name, `callout` or `Callout`, with its props, a bound prop
 * (`:items='[1,2]'`) as the value it holds. Anything else is its plain tag with its attributes; a
 * marker Hollware left for a raw HTML element renders nothing (`null`).
 */
export function elementOf(
  node: readonly unknown[],
  components: Readonly<Record<string, unknown>> = {},
): ContentElement | null {
  const tag = node[0]
  if (typeof tag !== 'string' || tag === 'hollware-marker') return null
  const raw = node[1]
  const props: Record<string, unknown> = {}
  if (typeof raw === 'object' && raw !== null && !Array.isArray(raw)) {
    for (const [key, value] of Object.entries(raw)) {
      if (key.startsWith(':')) {
        try {
          props[key.slice(1)] = typeof value === 'string' ? JSON.parse(value) : value
        } catch {
          props[key.slice(1)] = value
        }
      } else {
        props[key] = value
      }
    }
  }
  const children = node
    .slice(2)
    .filter((child): child is ContentNode => typeof child === 'string' || Array.isArray(child))
  const mapped = Object.hasOwn(components, tag)
    ? components[tag]
    : Object.hasOwn(components, pascal(tag))
      ? components[pascal(tag)]
      : undefined
  if (mapped !== undefined) return { tag: mapped, component: true, props, children, empty: false }
  // A plain tag takes attributes: text, numbers and switches, never an object it would print.
  const attributes = Object.fromEntries(
    Object.entries(props).filter(([, value]) =>
      ['string', 'number', 'boolean'].includes(typeof value),
    ),
  )
  return { tag, component: false, props: attributes, children, empty: VOID.has(tag) }
}

/**
 * The `<img>` of the image a frontmatter field of an entry holds (a cover): its URL, and its alt,
 * size and `srcset` when Hollware made copies of it. `null` when the field holds no URL.
 */
export function imageOf(
  entry: HollwareEntryLike | null | undefined,
  field: string,
): ImageAttributes | null {
  return imageOfEntry(
    { frontmatter: entry?.data ?? {}, images: metadataOf(entry).images ?? {} },
    field,
  )
}
