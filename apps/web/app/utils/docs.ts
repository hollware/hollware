import type { PageEntry } from '@hollware/nuxt'

export const SECTIONS = ['start', 'guides', 'frameworks', 'concepts', 'reference'] as const
export type Section = (typeof SECTIONS)[number]

export interface DocLink {
  readonly slug: string
  readonly title: string
  readonly description: string
  readonly section: string
  readonly order: number
  readonly to: string
  readonly locale: string
}

const text = (value: unknown, fallback: string) => (typeof value === 'string' ? value : fallback)

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
