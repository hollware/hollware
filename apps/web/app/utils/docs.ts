import type { PageEntry } from '@hollware/nuxt'

/** The sections of the sidebar, in their order, with the label a reader sees. */
export const SECTIONS = [
  { key: 'start', label: 'Getting started' },
  { key: 'guides', label: 'Guides' },
  { key: 'concepts', label: 'Concepts' },
  { key: 'reference', label: 'Reference' },
] as const

export interface DocLink {
  readonly slug: string
  readonly title: string
  readonly description: string
  readonly section: string
  readonly order: number
  readonly to: string
}

/** A string of the frontmatter, or `fallback` when the field holds anything else. */
const text = (value: unknown, fallback: string) => (typeof value === 'string' ? value : fallback)

/** A documentation page as the sidebar and the surround need it. */
export function docLink(entry: PageEntry): DocLink {
  const front = entry.frontmatter
  return {
    slug: entry.slug,
    title: text(front['title'], entry.slug),
    description: text(front['description'], ''),
    section: text(front['section'], 'guides'),
    order: typeof front['order'] === 'number' ? front['order'] : 999,
    to: `/docs/${entry.slug}/`,
  }
}

/** The pages in reading order: section by section, then by `order`, then by title. */
export function readingOrder(entries: readonly PageEntry[]): DocLink[] {
  const rank = (section: string) => {
    const index = SECTIONS.findIndex((candidate) => candidate.key === section)
    return index === -1 ? SECTIONS.length : index
  }
  return entries
    .map(docLink)
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
