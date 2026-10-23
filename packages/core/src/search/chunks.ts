import type { EntryDocument } from '../markdown/types.ts'

/**
 * The pieces of an entry that semantic search embeds (v0.5): one summary, and one piece for each
 * section the body has under an `h2`. Vectors are derived data, like the Comark document: a change
 * of this version makes every vector one to make again.
 */
export const CHUNKER_VERSION = '1'

export interface Chunk {
  /** The place of the piece in the entry: 0 is the summary, then the sections in order. */
  readonly index: number
  readonly kind: 'summary' | 'section'
  /** The heading of a section; `null` for the summary. */
  readonly heading: string | null
  readonly text: string
}

/** How long a piece may grow, in characters, before it is cut at a word. */
export const CHUNK_LIMITS = { summary: 1200, section: 2000 } as const

type Node = EntryDocument['nodes'][number]

export function documentText(document: EntryDocument): string {
  return document.nodes.map((node) => textOf(node)).join('\n')
}

function textOf(node: Node): string {
  if (typeof node === 'string') return node
  if (!Array.isArray(node) || node[0] === null) return ''
  return node
    .slice(2)
    .map((child) => textOf(child as Node))
    .join('')
}

function tagOf(node: Node): string | null {
  return Array.isArray(node) && typeof node[0] === 'string' ? node[0] : null
}

function fit(text: string, limit: number): string {
  const flat = text.replace(/\s+/g, ' ').trim()
  if (flat.length <= limit) return flat
  const cut = flat.slice(0, limit)
  const lastSpace = cut.lastIndexOf(' ')
  return (lastSpace > 0 ? cut.slice(0, lastSpace) : cut).trim()
}

/**
 * The pieces of an entry: the summary (its title, its description and the text before the first
 * `h2`), then each section (its heading and its text up to the next `h2`). An `h1` adds nothing:
 * it repeats the title. A section with no text is left out.
 */
export function chunksOf(entry: {
  readonly title: string
  readonly description?: string
  readonly document: EntryDocument
}): Chunk[] {
  const intro: string[] = []
  const sections: { heading: string; parts: string[] }[] = []
  for (const node of entry.document.nodes) {
    const tag = tagOf(node)
    if (tag === 'h1') continue
    if (tag === 'h2') {
      sections.push({ heading: textOf(node).trim(), parts: [] })
      continue
    }
    const text = textOf(node)
    const current = sections.at(-1)
    if (current === undefined) intro.push(text)
    else current.parts.push(text)
  }
  const summary = fit(
    [entry.title, entry.description ?? '', intro.join(' ')]
      .filter((part) => part !== '')
      .join('\n'),
    CHUNK_LIMITS.summary,
  )
  const chunks: Chunk[] = [{ index: 0, kind: 'summary', heading: null, text: summary }]
  for (const section of sections) {
    const body = section.parts.join(' ').trim()
    if (body === '') continue
    chunks.push({
      index: chunks.length,
      kind: 'section',
      heading: section.heading,
      text: fit(`${section.heading}\n${body}`, CHUNK_LIMITS.section),
    })
  }
  return chunks
}
