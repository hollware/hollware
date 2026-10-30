import type { Navigation, NavigationEntry } from '@hollware/core'
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

const docsPath = (slug: string, locale: string) =>
  `${locale === 'en' ? '' : `/${locale}`}/docs/${slug}/`

const text = (value: unknown, fallback: string) => (typeof value === 'string' ? value : fallback)

export function docLink(entry: PageEntry, locale = 'en'): DocLink {
  const front = entry.frontmatter
  return {
    slug: entry.slug,
    title: text(front['title'], entry.slug),
    description: text(front['description'], ''),
    section: text(front['section'], 'guides'),
    order: typeof front['order'] === 'number' ? front['order'] : 999,
    to: docsPath(entry.slug, locale),
    locale: entry.locale,
  }
}

function linkOf(
  entry: NavigationEntry,
  section: string | null,
  navigation: Navigation,
  locale: string,
): DocLink {
  return {
    slug: entry.slug,
    title: entry.title,
    description: entry.description ?? '',
    section: section ?? 'guides',
    order: entry.order ?? 999,
    to: docsPath(entry.slug, locale),
    locale: navigation.locale,
  }
}

function linksIn(
  navigation: Navigation | null | undefined,
  name: string | null,
  locale: string,
): DocLink[] {
  const group = navigation?.groups.find((candidate) => candidate.name === name)
  return navigation === null || navigation === undefined || group === undefined
    ? []
    : group.entries.map((entry) => linkOf(entry, name, navigation, locale))
}

export function docLinks(
  own: Navigation | null | undefined,
  locale = 'en',
  fallback: Navigation | null = null,
): DocLink[] {
  const names = [...(own?.groups ?? []), ...(fallback?.groups ?? [])].map((group) => group.name)
  const unique = [...new Set(names)]
  const ordered = [
    ...unique.filter((name) => name !== null),
    ...unique.filter((name) => name === null),
  ]
  const translated = new Set(
    own?.groups.flatMap((group) => group.entries.map((entry) => entry.slug)),
  )
  return ordered.flatMap((name) => {
    const links = linksIn(own, name, locale)
    if (fallback === null) return links
    return [
      ...links,
      ...linksIn(fallback, name, locale).filter((link) => !translated.has(link.slug)),
    ].sort((a, b) => a.order - b.order || a.title.localeCompare(b.title, locale))
  })
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
