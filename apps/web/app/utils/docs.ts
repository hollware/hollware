import type { PageEntry } from '@hollware/nuxt'

/** The sections of the sidebar, in their order; their labels are words of each language. */
export const SECTIONS = ['start', 'guides', 'concepts', 'reference'] as const
export type Section = (typeof SECTIONS)[number]

export interface DocLink {
  readonly slug: string
  readonly title: string
  readonly description: string
  readonly section: string
  readonly order: number
  readonly to: string
  /** The locale the page is written in, which is the reader's unless it is not translated yet. */
  readonly locale: string
}

/** A string of the frontmatter, or `fallback` when the field holds anything else. */
const text = (value: unknown, fallback: string) => (typeof value === 'string' ? value : fallback)

/** A documentation page as the sidebar and the surround need it, at its path in `locale`. */
export function docLink(entry: PageEntry, locale = 'en'): DocLink {
  const front = entry.frontmatter
  return {
    slug: entry.slug,
    title: text(front['title'], entry.slug),
    description: text(front['description'], ''),
    section: text(front['section'], 'guides'),
    order: typeof front['order'] === 'number' ? front['order'] : 999,
    to: `${locale === 'en' ? '' : `/${locale}`}/docs/${entry.slug}/`,
    locale: entry.locale,
  }
}

/**
 * The pages in reading order, at their paths in `locale`: section by section, then by `order`,
 * then by title. A page of `fallback` stands for one with its slug that `entries` lacks, so a
 * page not translated yet is still in the sidebar, in the language it is written in.
 */
export function readingOrder(
  entries: readonly PageEntry[],
  locale = 'en',
  fallback: readonly PageEntry[] = [],
): DocLink[] {
  const rank = (section: string) => {
    const index = SECTIONS.findIndex((candidate) => candidate === section)
    return index === -1 ? SECTIONS.length : index
  }
  const slugs = new Set(entries.map((entry) => entry.slug))
  return [...entries, ...fallback.filter((entry) => !slugs.has(entry.slug))]
    .map((entry) => docLink(entry, locale))
    .sort(
      (a, b) =>
        rank(a.section) - rank(b.section) || a.order - b.order || a.title.localeCompare(b.title),
    )
}

/** A heading of the document, for the table of contents of a page. */
export interface Heading {
  readonly id: string
  readonly text: string
  readonly depth: 2 | 3
}

type Node = string | [string, Record<string, unknown>, ...Node[]]

function textOf(node: Node): string {
  if (typeof node === 'string') return node
  const [, , ...children] = node
  return children.map(textOf).join('')
}

/** The h2 and h3 of a Comark document, with the ids the renderer gives them. */
export function headingsOf(document: unknown): Heading[] {
  if (typeof document !== 'object' || document === null || !('nodes' in document)) return []
  const nodes = (document as { nodes: Node[] }).nodes
  return nodes.flatMap((node) => {
    if (typeof node === 'string') return []
    const [tag, props] = node
    const id = props['id']
    if ((tag !== 'h2' && tag !== 'h3') || typeof id !== 'string') return []
    return [{ id, text: textOf(node), depth: tag === 'h2' ? 2 : 3 } as const]
  })
}
