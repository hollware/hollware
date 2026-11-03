import { OPERATIONS } from '@hollware/core'
import hollwarePackage from '@hollware/core/package.json'

export const ORIGIN = 'https://hollware.com'

export const PAGE_COLLECTIONS = ['pages', 'glossary'] as const
export type PageCollection = (typeof PAGE_COLLECTIONS)[number]

export const LISTED = ['glossary'] as const

export const FACTS = {
  tools: String(OPERATIONS.length),
  version: hollwarePackage.version,
  license: 'MIT',
} as const
export type FactName = keyof typeof FACTS

export function factOf(name: unknown): string {
  return typeof name === 'string' && Object.hasOwn(FACTS, name) ? FACTS[name as FactName] : ''
}

export function withFacts(markdown: string): string {
  return markdown.replace(/:fact\{name="([a-z]+)"\}/g, (whole, name: string) =>
    Object.hasOwn(FACTS, name) ? FACTS[name as FactName] : whole,
  )
}

const prefix = (locale: string) => (locale === 'en' ? '' : `/${locale}`)

export function pathOf(collection: string, slug: string, locale: string): string {
  if (collection === 'pages')
    return slug === 'home' ? `${prefix(locale)}/` : `${prefix(locale)}/${slug}/`
  return `${prefix(locale)}/${collection}/${slug}/`
}

export function markdownPathOf(collection: string, slug: string, locale: string): string {
  if (collection === 'pages') return `${prefix(locale)}/${slug === 'home' ? 'index' : slug}.md`
  return `${prefix(locale)}/${collection}/${slug}.md`
}

export interface MarkdownTarget {
  readonly collection: 'docs' | PageCollection
  readonly slug: string
  readonly locale: 'en' | 'es'
}

const SLUG = '[a-z0-9]+(?:-[a-z0-9]+)*'
const IN_COLLECTION = new RegExp(`^(/es)?/(docs|glossary)/(${SLUG})\\.md$`)
const A_PAGE = new RegExp(`^(/es)?/(${SLUG})\\.md$`)

export function markdownTarget(pathname: string): MarkdownTarget | null {
  const listed = IN_COLLECTION.exec(pathname)
  if (listed !== null) {
    const [, es, collection, slug] = listed
    return {
      collection: collection as MarkdownTarget['collection'],
      slug: slug ?? '',
      locale: es === undefined ? 'en' : 'es',
    }
  }
  const page = A_PAGE.exec(pathname)
  if (page === null) return null
  const [, es, name] = page
  if (name === 'llms' || name === 'home') return null
  return {
    collection: 'pages',
    slug: name === 'index' ? 'home' : (name ?? ''),
    locale: es === undefined ? 'en' : 'es',
  }
}

type Node = string | [string, Record<string, unknown>, ...Node[]]

export function textOfNode(node: Node): string {
  if (typeof node === 'string') return node
  const [, , ...children] = node
  return children.map(textOfNode).join('')
}

function nodesOf(document: unknown): Node[] {
  if (typeof document !== 'object' || document === null || !('nodes' in document)) return []
  const nodes = (document as { nodes: unknown }).nodes
  return Array.isArray(nodes) ? (nodes as Node[]) : []
}

function find(nodes: readonly Node[], tag: string): Node[] {
  return nodes.flatMap((node) => {
    if (typeof node === 'string') return []
    const [name, , ...children] = node
    return name === tag ? [node] : find(children, tag)
  })
}

function contentOf(node: Node): Node[] {
  if (typeof node === 'string') return [node]
  const [, , ...children] = node
  return children.flatMap((child) =>
    typeof child !== 'string' && child[0] === 'template' ? contentOf(child) : [child],
  )
}

const squeeze = (text: string) => text.replace(/\s+/g, ' ').trim()

export interface Question {
  readonly question: string
  readonly answer: string
}

export function faqOf(document: unknown): Question[] {
  return find(nodesOf(document), 'faq').flatMap((faq) => {
    const questions: { question: string; answer: string[] }[] = []
    for (const child of contentOf(faq)) {
      if (typeof child === 'string') continue
      if (child[0] === 'h3') questions.push({ question: squeeze(textOfNode(child)), answer: [] })
      else questions.at(-1)?.answer.push(squeeze(textOfNode(child)))
    }
    return questions
      .map(({ question, answer }) => ({ question, answer: answer.filter(Boolean).join(' ') }))
      .filter(({ question, answer }) => question !== '' && answer !== '')
  })
}

export function formatDay(day: string, locale: string): string {
  const date = new Date(`${day}T00:00:00Z`)
  if (Number.isNaN(date.getTime())) return day
  return new Intl.DateTimeFormat(locale, { dateStyle: 'long', timeZone: 'UTC' }).format(date)
}

const OWN_HEAD =
  /^(\/es)?(?:\/|\/(?:glossary(?:\/.*)?|features\/?|compare\/?|install\/?|media-kit\/?))?$/

export function ownsHead(path: string): boolean {
  return OWN_HEAD.test(path)
}
