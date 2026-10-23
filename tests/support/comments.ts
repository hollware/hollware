import { createRequire } from 'node:module'
import { basename, join } from 'node:path'
import { isScalar, LineCounter, Parser, parseDocument, visit } from 'yaml'
import { commentsOf } from './source.ts'

export interface Comment {
  text: string
  start: number
  end: number
}

export type CommentSyntax =
  | 'script'
  | 'vue'
  | 'astro'
  | 'markup'
  | 'css'
  | 'jsonc'
  | 'yaml'
  | 'shell'
  | 'hash-lines'
  | 'sql'

const SCRIPT = /\.(?:[cm]?[jt]s|[jt]sx)$/
const HASH_LINE_NAMES = new Set([
  '.gitignore',
  'gitignore',
  '.gitattributes',
  'CODEOWNERS',
  '.npmrc',
  '.node-version',
])

export function commentSyntaxOf(path: string): CommentSyntax | undefined {
  const name = basename(path)
  if (SCRIPT.test(name)) return 'script'
  if (name.endsWith('.vue')) return 'vue'
  if (name.endsWith('.astro')) return 'astro'
  if (/\.(?:html|svg|xml)$/.test(name)) return 'markup'
  if (name.endsWith('.css')) return 'css'
  if (/\.jsonc?$/.test(name)) return 'jsonc'
  if (/\.ya?ml$/.test(name)) return 'yaml'
  if (name.endsWith('.sh') || path.startsWith('.vite-hooks/')) return 'shell'
  if (name.endsWith('.sql')) return 'sql'
  if (HASH_LINE_NAMES.has(name) || name.endsWith('.tsv')) return 'hash-lines'
  return undefined
}

export function commentsIn(path: string, text: string): Comment[] {
  switch (commentSyntaxOf(path)) {
    case 'script':
      return commentsOf(path, text)
    case 'vue':
      return vueComments(path, text)
    case 'astro':
      return astroComments(text)
    case 'markup':
      return markupComments(text, 0, text.length)
    case 'css':
      return cssComments(text, 0, text.length)
    case 'jsonc':
      return jsoncComments(text)
    case 'yaml':
      return yamlComments(text)
    case 'shell':
      return shellComments(text, 0, text.length)
    case 'sql':
      return sqlComments(text)
    case 'hash-lines':
      return hashLineComments(text)
    case undefined:
      return []
  }
}

function shifted(comments: readonly Comment[], offset: number): Comment[] {
  return comments.map((comment) => ({
    text: comment.text,
    start: comment.start + offset,
    end: comment.end + offset,
  }))
}

function scriptComments(text: string, start: number, end: number, lang: string): Comment[] {
  const extension = lang === 'tsx' || lang === 'jsx' || lang === 'js' ? lang : 'ts'
  return shifted(commentsOf(`block.${extension}`, text.slice(start, end)), start)
}

interface SfcBlock {
  content: string
  lang?: string
  loc: { start: { offset: number }; end: { offset: number } }
}

interface SfcNode {
  type: number
  loc: { start: { offset: number }; end: { offset: number } }
  children?: readonly SfcNode[]
}

interface CompilerSfc {
  parse(
    source: string,
    options: { filename: string },
  ): {
    descriptor: {
      template: (SfcBlock & { ast?: SfcNode }) | null
      script: SfcBlock | null
      scriptSetup: SfcBlock | null
      styles: readonly SfcBlock[]
    }
  }
}

const fromAdmin = createRequire(
  join(import.meta.dirname, '..', '..', 'packages', 'admin', 'package.json'),
)
const sfc: CompilerSfc = fromAdmin('vue/compiler-sfc')

const TEMPLATE_COMMENT = 3

function vueComments(path: string, text: string): Comment[] {
  const { descriptor } = sfc.parse(text, { filename: path })
  const found: Comment[] = []
  const blocks: [number, number][] = []
  for (const block of [descriptor.script, descriptor.scriptSetup]) {
    if (block === null) continue
    blocks.push([block.loc.start.offset, block.loc.end.offset])
    found.push(
      ...scriptComments(text, block.loc.start.offset, block.loc.end.offset, block.lang ?? 'js'),
    )
  }
  for (const style of descriptor.styles) {
    blocks.push([style.loc.start.offset, style.loc.end.offset])
    found.push(...cssComments(text, style.loc.start.offset, style.loc.end.offset))
  }
  const template = descriptor.template
  if (template !== null) {
    blocks.push([template.loc.start.offset, template.loc.end.offset])
    const walk = (node: SfcNode): void => {
      if (node.type === TEMPLATE_COMMENT) {
        found.push({
          text: text.slice(node.loc.start.offset, node.loc.end.offset),
          start: node.loc.start.offset,
          end: node.loc.end.offset,
        })
      }
      for (const child of node.children ?? []) walk(child)
    }
    if (template.ast !== undefined) walk(template.ast)
  }
  const outside = markupComments(text, 0, text.length).filter(
    (comment) => !blocks.some(([start, end]) => comment.start >= start && comment.end <= end),
  )
  return [...found, ...outside].sort((a, b) => a.start - b.start)
}

const FRONTMATTER = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/
const ELEMENT_BLOCK = /<(script|style)\b[^>]*>([\s\S]*?)<\/\1>/g
const EXPRESSION_COMMENT = /\{\s*\/\*[\s\S]*?\*\/\s*\}/g

function astroComments(text: string): Comment[] {
  const found: Comment[] = []
  let markupStart = 0
  const frontmatter = FRONTMATTER.exec(text)
  if (frontmatter?.[1] !== undefined) {
    const start = text.indexOf(frontmatter[1])
    found.push(...scriptComments(text, start, start + frontmatter[1].length, 'ts'))
    markupStart = frontmatter[0].length
  }
  const blocks: [number, number][] = []
  for (const match of text.slice(markupStart).matchAll(ELEMENT_BLOCK)) {
    const body = match[2] ?? ''
    const start = markupStart + match.index + match[0].indexOf('>') + 1
    blocks.push([start, start + body.length])
    if (match[1] === 'script') found.push(...scriptComments(text, start, start + body.length, 'ts'))
    else found.push(...cssComments(text, start, start + body.length))
  }
  const inBlock = (comment: Comment): boolean =>
    blocks.some(([start, end]) => comment.start >= start && comment.end <= end)
  found.push(...markupComments(text, markupStart, text.length).filter((c) => !inBlock(c)))
  for (const match of text.slice(markupStart).matchAll(EXPRESSION_COMMENT)) {
    const start = markupStart + match.index
    const comment = { text: match[0], start, end: start + match[0].length }
    if (!inBlock(comment)) found.push(comment)
  }
  return found.sort((a, b) => a.start - b.start)
}

function markupComments(text: string, from: number, to: number): Comment[] {
  const found: Comment[] = []
  let i = text.indexOf('<!--', from)
  while (i !== -1 && i < to) {
    const close = text.indexOf('-->', i + 4)
    const end = close === -1 ? to : close + 3
    found.push({ text: text.slice(i, end), start: i, end })
    i = text.indexOf('<!--', end)
  }
  return found
}

function quoted(text: string, i: number, quote: string, escapes: boolean, to: number): number {
  let j = i + 1
  while (j < to) {
    const char = text.charAt(j)
    if (escapes && char === '\\') j += 2
    else if (char === quote) return j + 1
    else j += 1
  }
  return to
}

function blockEnd(text: string, i: number, to: number): number {
  const close = text.indexOf('*/', i + 2)
  return close === -1 || close + 2 > to ? to : close + 2
}

function lineEnd(text: string, i: number, to: number): number {
  const newline = text.indexOf('\n', i)
  return newline === -1 || newline > to ? to : newline
}

function cssComments(text: string, from: number, to: number): Comment[] {
  const found: Comment[] = []
  let i = from
  while (i < to) {
    const char = text.charAt(i)
    if (char === '"' || char === "'") i = quoted(text, i, char, true, to)
    else if (char === '/' && text.charAt(i + 1) === '*') {
      const end = blockEnd(text, i, to)
      found.push({ text: text.slice(i, end), start: i, end })
      i = end
    } else i += 1
  }
  return found
}

export function jsoncComments(text: string): Comment[] {
  const found: Comment[] = []
  let i = 0
  while (i < text.length) {
    const char = text.charAt(i)
    const next = text.charAt(i + 1)
    if (char === '"') i = quoted(text, i, '"', true, text.length)
    else if (char === '/' && (next === '/' || next === '*')) {
      const end = next === '/' ? lineEnd(text, i, text.length) : blockEnd(text, i, text.length)
      found.push({ text: text.slice(i, end), start: i, end })
      i = end
    } else i += 1
  }
  return found
}

function sqlComments(text: string): Comment[] {
  const found: Comment[] = []
  let i = 0
  while (i < text.length) {
    const char = text.charAt(i)
    const next = text.charAt(i + 1)
    if (char === "'" || char === '"' || char === '`') i = quoted(text, i, char, false, text.length)
    else if ((char === '-' && next === '-') || (char === '/' && next === '*')) {
      const end = char === '-' ? lineEnd(text, i, text.length) : blockEnd(text, i, text.length)
      found.push({ text: text.slice(i, end), start: i, end })
      i = end
    } else i += 1
  }
  return found
}

function hashLineComments(text: string): Comment[] {
  const found: Comment[] = []
  let start = 0
  for (const line of text.split('\n')) {
    const indent = line.length - line.trimStart().length
    if (line.trimStart().startsWith('#')) {
      found.push({ text: line.slice(indent), start: start + indent, end: start + line.length })
    }
    start += line.length + 1
  }
  return found
}

const WORD_START = new Set([' ', '\t', '\n', ';', '&', '|', '(', ')', '<', '>'])
const HEREDOC = /^<<(-?)[ \t]*(['"]?)([A-Za-z_][A-Za-z0-9_]*)\2/

export function shellComments(text: string, from: number, to: number): Comment[] {
  const found: Comment[] = []
  const heredocs: string[] = []
  let i = from
  while (i < to) {
    const char = text.charAt(i)
    if (char === '\\') i += 2
    else if (char === "'") i = quoted(text, i, "'", false, to)
    else if (char === '"') i = quoted(text, i, '"', true, to)
    else if (char === '$' && text.charAt(i + 1) === "'") i = quoted(text, i + 1, "'", true, to)
    else if (char === '<' && text.startsWith('<<', i) && !text.startsWith('<<<', i)) {
      const match = HEREDOC.exec(text.slice(i, to))
      if (match?.[3] !== undefined) {
        heredocs.push(match[3])
        i += match[0].length
      } else i += 2
    } else if (char === '\n' && heredocs.length > 0) {
      let j = i + 1
      while (heredocs.length > 0 && j < to) {
        const end = lineEnd(text, j, to)
        if (text.slice(j, end).trim() === heredocs[0]) heredocs.shift()
        j = end + 1
      }
      i = j - 1
    } else if (char === '#' && (i === from || WORD_START.has(text.charAt(i - 1)))) {
      const end = lineEnd(text, i, to)
      found.push({ text: text.slice(i, end), start: i, end })
      i = end
    } else i += 1
  }
  return found
}

interface CstToken {
  type?: unknown
  offset?: unknown
  source?: unknown
}

function cstComments(token: unknown, found: Comment[], seen: Set<unknown>): void {
  if (token === null || typeof token !== 'object' || seen.has(token)) return
  seen.add(token)
  if (Array.isArray(token)) {
    for (const item of token) cstComments(item, found, seen)
    return
  }
  const { type, offset, source }: CstToken = token
  if (type === 'comment' && typeof offset === 'number' && typeof source === 'string') {
    found.push({ text: source, start: offset, end: offset + source.length })
    return
  }
  for (const value of Object.values(token)) cstComments(value, found, seen)
}

function yamlComments(text: string): Comment[] {
  const found: Comment[] = []
  const seen = new Set<unknown>()
  for (const token of new Parser().parse(text)) cstComments(token, found, seen)
  const lineCounter = new LineCounter()
  const doc = parseDocument(text, { lineCounter })
  visit(doc, {
    Pair(_, pair) {
      const key = isScalar(pair.key) ? pair.key.value : undefined
      const value = pair.value
      if (key !== 'run' || !isScalar(value) || typeof value.value !== 'string') return
      const range = value.range
      if (range === undefined || range === null) return
      if (value.type !== 'BLOCK_LITERAL' && value.type !== 'BLOCK_FOLDED') return
      const bodyStart = text.indexOf('\n', range[0]) + 1
      found.push(...shellComments(text, bodyStart, range[1]))
    },
  })
  return [...new Map(found.map((comment) => [comment.start, comment])).values()].sort(
    (a, b) => a.start - b.start,
  )
}
