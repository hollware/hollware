/**
 * Portable Text (portabletext.org), the JSON that EmDash keeps rich text as, written as the
 * Markdown Hollware stores. What has a Markdown form gets it: paragraphs, headings, quotes, lists
 * (nested by `level`), strong, em, code, strike and underline as their Markdown or nothing, links
 * through their mark definitions, code blocks and images. A block of any other type has none: it
 * is left out and named in `skipped`, so an import says what it could not carry instead of
 * inventing a component the collection does not declare.
 */

type Json = Readonly<Record<string, unknown>>

const isObject = (value: unknown): value is Json =>
  typeof value === 'object' && value !== null && !Array.isArray(value)
const text = (value: unknown): string => (typeof value === 'string' ? value : '')

export interface Converted {
  readonly markdown: string
  /** The types of the blocks left out, once each, in the order met. */
  readonly skipped: readonly string[]
}

/** The characters Markdown reads as markup in running text, escaped. */
function escapeText(value: string): string {
  return value.replace(/([\\`*_[\]<>#|])/g, '\\$1')
}

/** A span with its marks: decorators as Markdown, a link from the block's mark definitions. */
function spanOf(span: Json, definitions: ReadonlyMap<string, Json>): string {
  const marks = Array.isArray(span['marks']) ? span['marks'].map(text) : []
  let out = marks.includes('code') ? `\`${text(span['text'])}\`` : escapeText(text(span['text']))
  if (out === '') return ''
  if (marks.includes('strong')) out = `**${out}**`
  if (marks.includes('em')) out = `*${out}*`
  if (marks.includes('strike-through')) out = `~~${out}~~`
  for (const key of marks) {
    const definition = definitions.get(key)
    if (definition === undefined) continue
    const href = text(definition['href'])
    if (definition['_type'] === 'link' && href !== '') out = `[${out}](${href})`
  }
  return out
}

/** The inline text of a text block. */
function inlineOf(block: Json): string {
  const definitions = new Map(
    (Array.isArray(block['markDefs']) ? block['markDefs'] : [])
      .filter(isObject)
      .map((definition) => [text(definition['_key']), definition] as const),
  )
  return (Array.isArray(block['children']) ? block['children'] : [])
    .filter(isObject)
    .map((child) => (child['_type'] === 'span' ? spanOf(child, definitions) : ''))
    .join('')
}

const HEADINGS: Readonly<Record<string, string>> = {
  h1: '#',
  h2: '##',
  h3: '###',
  h4: '####',
  h5: '#####',
  h6: '######',
}

/** The Markdown of a list of Portable Text blocks: blocks apart by a blank line, list items not. */
export function portableTextToMarkdown(value: unknown): Converted {
  const blocks = Array.isArray(value) ? value.filter(isObject) : []
  const parts: { readonly markdown: string; readonly item: boolean }[] = []
  const skipped: string[] = []
  const counters = new Map<number, number>()
  for (const block of blocks) {
    const type = text(block['_type'])
    if (type === 'block') {
      const inline = inlineOf(block)
      const listItem = text(block['listItem'])
      if (listItem === 'bullet' || listItem === 'number') {
        const level = typeof block['level'] === 'number' && block['level'] > 0 ? block['level'] : 1
        for (const deeper of counters.keys()) if (deeper > level) counters.delete(deeper)
        const count = (counters.get(level) ?? 0) + 1
        counters.set(level, count)
        const marker = listItem === 'number' ? `${count}.` : '-'
        parts.push({ markdown: `${'  '.repeat(level - 1)}${marker} ${inline}`, item: true })
        continue
      }
      counters.clear()
      const style = text(block['style']) || 'normal'
      const heading = HEADINGS[style]
      if (inline === '') continue
      if (heading !== undefined) parts.push({ markdown: `${heading} ${inline}`, item: false })
      else if (style === 'blockquote') parts.push({ markdown: `> ${inline}`, item: false })
      else parts.push({ markdown: inline, item: false })
      continue
    }
    counters.clear()
    if (type === 'code') {
      const code = text(block['code'])
      const fence = code.includes('```') ? '~~~' : '```'
      parts.push({ markdown: `${fence}${text(block['language'])}\n${code}\n${fence}`, item: false })
      continue
    }
    if (type === 'image') {
      const url = text(block['url']) || text(isObject(block['asset']) ? block['asset']['url'] : '')
      if (url !== '') {
        parts.push({ markdown: `![${escapeText(text(block['alt']))}](${url})`, item: false })
        continue
      }
    }
    if (!skipped.includes(type || 'unknown')) skipped.push(type || 'unknown')
  }
  let markdown = ''
  parts.forEach((part, index) => {
    const previous = parts[index - 1]
    if (previous !== undefined) markdown += previous.item && part.item ? '\n' : '\n\n'
    markdown += part.markdown
  })
  return { markdown: markdown === '' ? '' : `${markdown}\n`, skipped }
}
