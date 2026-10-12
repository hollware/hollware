/**
 * Just enough Markdown for the guards: fenced code blocks, ATX headings, inline code spans
 * and pipe tables. It is not a CommonMark parser. Limits: indented code blocks and HTML
 * blocks are not recognized, and a fence is any line that starts with three or more
 * backticks or tildes.
 */

const FENCE = /^\s*(`{3,}|~{3,})/

/**
 * The text with the fenced code blocks emptied, fences included. The line count stays the
 * same, so line numbers computed on the result are the real ones.
 */
export function stripFencedBlocks(text: string): string {
  return fencedLines(text)
    .map(({ line, inFence }) => (inFence ? '' : line))
    .join('\n')
}

/** Every line of the text, with whether it belongs to a fenced block (fence lines included). */
export function fencedLines(text: string): { line: string; inFence: boolean }[] {
  const lines = text.split('\n')
  const result: { line: string; inFence: boolean }[] = []
  let opener: string | undefined
  for (const line of lines) {
    const match = FENCE.exec(line)
    const marker = match?.[1]
    if (opener === undefined) {
      if (marker !== undefined) {
        opener = marker
        result.push({ line, inFence: true })
      } else {
        result.push({ line, inFence: false })
      }
    } else {
      result.push({ line, inFence: true })
      const closes =
        marker !== undefined &&
        marker.startsWith(opener.charAt(0)) &&
        marker.length >= opener.length &&
        line.trim() === marker
      if (closes) opener = undefined
    }
  }
  return result
}

export interface Heading {
  level: number
  text: string
  line: number
}

/** The ATX headings (`# Title`) outside fenced blocks. */
export function headings(text: string): Heading[] {
  const found: Heading[] = []
  for (const [index, line] of stripFencedBlocks(text).split('\n').entries()) {
    const match = /^(#{1,6})[ \t]+(.+?)[ \t]*#*[ \t]*$/.exec(line)
    const hashes = match?.[1]
    const title = match?.[2]
    if (hashes !== undefined && title !== undefined) {
      found.push({ level: hashes.length, text: title, line: index + 1 })
    }
  }
  return found
}

export interface CodeSpan {
  text: string
  line: number
}

/**
 * The inline code spans (`like this`) outside fenced blocks. A span opens with a run of N
 * backticks and closes with the next run of exactly N, as in CommonMark.
 */
export function inlineCodeSpans(text: string): CodeSpan[] {
  const source = stripFencedBlocks(text)
  const spans: CodeSpan[] = []
  const run = /`+/g
  let opening = run.exec(source)
  while (opening !== null) {
    const length = opening[0].length
    const contentStart = opening.index + length
    let closing: RegExpExecArray | null
    const search = new RegExp('`+', 'g')
    search.lastIndex = contentStart
    do {
      closing = search.exec(source)
    } while (closing !== null && closing[0].length !== length)
    if (closing === null) {
      // No closing run: the backticks are literal text.
      run.lastIndex = contentStart
    } else {
      const content = source.slice(contentStart, closing.index).replace(/\s+/g, ' ').trim()
      const line = source.slice(0, opening.index).split('\n').length
      spans.push({ text: content, line })
      run.lastIndex = closing.index + length
    }
    opening = run.exec(source)
  }
  return spans
}

/** The lines of a `## <title>` section, up to the next heading of level 1 or 2. */
export function sectionLines(text: string, title: string): { line: string; number: number }[] {
  const lines = text.split('\n')
  const fenced = fencedLines(text)
  const found: { line: string; number: number }[] = []
  let inside = false
  for (const [index, line] of lines.entries()) {
    const isFenced = fenced[index]?.inFence === true
    const heading = isFenced ? null : /^(#{1,2})[ \t]+(.+?)[ \t]*$/.exec(line)
    if (heading !== null) {
      inside = heading[1] === '##' && heading[2] === title
      continue
    }
    if (inside) found.push({ line, number: index + 1 })
  }
  return found
}

/** The cells of a pipe-table row (`| a | b |`), or `undefined` when the line is not a row. */
export function tableCells(line: string): string[] | undefined {
  const trimmed = line.trim()
  if (!trimmed.startsWith('|') || !trimmed.endsWith('|') || trimmed.length < 2) return undefined
  return trimmed
    .slice(1, -1)
    .split(/(?<!\\)\|/)
    .map((cell) => cell.trim())
}
