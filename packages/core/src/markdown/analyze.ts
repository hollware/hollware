import type { MarkdownDocument } from 'comark'
import { jsonProblem } from './json.ts'
import {
  INLINE_TAGS,
  LEFT_OUT_TAG,
  LINE_KEY,
  MARKER_TAG,
  MAX_DEPTH,
  NATIVE_TAGS,
  OPEN_KEY,
  PROPS_KEY,
  RAW_HTML_PREFIX,
  attributeName,
  displayAttribute,
  isAllowedAttribute,
  isForbiddenAttribute,
  isSafeUrl,
  parseJson,
  setOwn,
  shorten,
  urlValue,
  type UrlKind,
} from './policy.ts'
import { classifyLink, type CompiledRoute } from './routes.ts'
import { HeadingIds } from './slug.ts'
import type {
  ComponentUse,
  DisallowedMarker,
  ExtractedContent,
  Heading,
  ImageRef,
  LinkRef,
} from './types.ts'

type Props = Record<string, unknown>

export interface AnalyzeOptions {
  readonly components: ReadonlySet<string>
  readonly routes: readonly CompiledRoute[]
  readonly lineOffset: number
}

export type Problem = 'nesting' | 'props'

export interface Analysis {
  readonly extracted: ExtractedContent
  readonly problem: Problem | undefined
}

interface LeftOut {
  readonly line: number
  readonly tag: string
  readonly given: boolean
  readonly text: string
}

interface State {
  readonly options: AnalyzeOptions
  readonly leftOut: ReadonlyMap<number, LeftOut>
  readonly taken: Set<number>
  readonly headings: Heading[]
  readonly links: LinkRef[]
  readonly images: ImageRef[]
  readonly components: ComponentUse[]
  readonly disallowed: DisallowedMarker[]
  readonly reported: Set<string>
  readonly ids: HeadingIds
  words: number
  inWord: boolean
  codeWords: number
  inCodeWord: boolean
  problem: Problem | undefined
}

const HEADING_LEVEL: ReadonlyMap<string, Heading['depth']> = new Map([
  ['h1', 1],
  ['h2', 2],
  ['h3', 3],
  ['h4', 4],
  ['h5', 5],
  ['h6', 6],
])

function isProps(value: unknown): value is Props {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isSpace(code: number): boolean {
  return (
    code === 32 ||
    (code >= 9 && code <= 13) ||
    code === 160 ||
    code === 5760 ||
    (code >= 8192 && code <= 8202) ||
    code === 8232 ||
    code === 8233 ||
    code === 8239 ||
    code === 8287 ||
    code === 12288 ||
    code === 65279
  )
}

function countNewlines(text: string): number {
  let count = 0
  let at = text.indexOf('\n')
  while (at !== -1) {
    count++
    at = text.indexOf('\n', at + 1)
  }
  return count
}

function addCode(state: State, text: string): void {
  for (let at = 0; at < text.length; at++) {
    if (isSpace(text.charCodeAt(at))) {
      state.inCodeWord = false
    } else if (!state.inCodeWord) {
      state.inCodeWord = true
      state.codeWords++
    }
  }
}

function addText(state: State, text: string): void {
  for (let at = 0; at < text.length; at++) {
    if (isSpace(text.charCodeAt(at))) {
      state.inWord = false
    } else if (!state.inWord) {
      state.inWord = true
      state.words++
    }
  }
}

function plainText(node: readonly unknown[], depth: number): string {
  let text = ''
  for (let at = 2; at < node.length; at++) {
    const child = node[at]
    if (typeof child === 'string') text += child
    else if (Array.isArray(child) && depth < MAX_DEPTH) text += plainText(child, depth + 1)
  }
  return text
}

function takeLine(props: Props, key: string, lineOffset: number): number | undefined {
  if (!Object.hasOwn(props, key)) return undefined
  const value = props[key]
  delete props[key]
  const line = typeof value === 'string' ? Number.parseInt(value, 10) : Number.NaN
  return Number.isSafeInteger(line) && line >= 0 ? line + 1 + lineOffset : undefined
}

function takeLeftOut(nodes: unknown[], lineOffset: number): Map<number, LeftOut> {
  const found = new Map<number, LeftOut>()
  const last: unknown = nodes[nodes.length - 1]
  if (!Array.isArray(last) || last[0] !== LEFT_OUT_TAG) return found
  nodes.pop()
  const props: unknown = last[1]
  if (!isProps(props)) return found
  for (const key of Object.keys(props)) {
    const id = PROPS_KEY.exec(key)?.[1]
    const value = props[key]
    if (id === undefined || typeof value !== 'string') continue
    const [line = '', tag = '', given = '', ...text] = value.split('\u0000')
    const at = Number.parseInt(line, 10)
    if (Number.isSafeInteger(at) && at >= 0) {
      found.set(Number(id), {
        line: at + 1 + lineOffset,
        tag,
        given: given === '1',
        text: text.join('\u0000'),
      })
    }
  }
  return found
}

function takeProps(state: State, props: Props): void {
  for (const key of Object.keys(props)) {
    const id = PROPS_KEY.exec(key)?.[1]
    if (id !== undefined) {
      delete props[key]
      state.taken.add(Number(id))
    }
  }
}

function record(state: State, kind: DisallowedMarker['kind'], name: string, line: number): void {
  const shortName = shorten(name)
  const key = `${kind}\u0000${shortName}\u0000${line}`
  if (state.reported.has(key)) return
  state.reported.add(key)
  state.disallowed.push({ kind, name: shortName, line })
}

function markerNode(
  kind: DisallowedMarker['kind'],
  name: string,
  line: number,
  children: readonly unknown[],
): unknown[] {
  return [MARKER_TAG, { kind, name: shorten(name), line }, ...children]
}

function decodeProps(props: Props): Props {
  const decoded: Props = {}
  for (const key of Object.keys(props)) {
    const value = props[key]
    if (key.startsWith(':')) {
      setOwn(decoded, key.slice(1), typeof value === 'string' ? parseJson(value) : value)
    } else {
      setOwn(decoded, key, value)
    }
  }
  return decoded
}

function urlKind(tag: string, key: string, native: boolean): UrlKind | undefined {
  if (native) {
    if (tag === 'a' && key === 'href') return 'link'
    return tag === 'img' && key === 'src' ? 'image' : undefined
  }
  const name = attributeName(key)
  if (name === 'to' || name === 'link' || /(?:href|url)$/.test(name)) return 'link'
  return name.endsWith('src') ? 'image' : undefined
}

function cleanProps(state: State, tag: string, props: Props, native: boolean, line: number): void {
  for (const key of Object.keys(props)) {
    const value = props[key]
    const forbidden = native
      ? !isAllowedAttribute(tag, key, value)
      : isForbiddenAttribute(attributeName(key))
    if (forbidden) {
      delete props[key]
      record(state, 'disallowed-attribute', `${tag}[${displayAttribute(key)}]`, line)
      continue
    }
    const kind = urlKind(tag, key, native)
    if (kind !== undefined) {
      const url = urlValue(key, value)
      if (url === undefined) {
        delete props[key]
        record(state, 'disallowed-attribute', `${tag}[${displayAttribute(key)}]`, line)
      } else if (!isSafeUrl(url, kind)) {
        delete props[key]
        record(state, 'unsafe-url', url, line)
      }
    } else if (
      !native &&
      typeof value === 'object' &&
      value !== null &&
      jsonProblem(value) !== undefined
    ) {
      state.problem ??= 'props'
    }
  }
}

function bracket(node: unknown[]): void {
  const last = node.length - 1
  const end: unknown = node[last]
  if (last >= 2 && typeof end === 'string') node[last] = `${end}]`
  else node.push(']')
  const first: unknown = node[2]
  if (typeof first === 'string') node[2] = `[${first}`
  else node.splice(2, 0, '[')
}

function collectLink(state: State, props: Props, line: number): void {
  const href = props.href
  if (typeof href !== 'string') return
  const { kind, target } = classifyLink(href, state.options.routes)
  state.links.push(target === undefined ? { href, kind, line } : { href, kind, target, line })
}

function collectImage(state: State, props: Props, line: number): void {
  const src = props.src
  if (typeof src !== 'string' || src === '') return
  const alt = props.alt
  state.images.push({ src, alt: typeof alt === 'string' ? alt : '', line })
}

function walk(
  state: State,
  list: unknown[],
  start: number,
  firstLine: number,
  depth: number,
  inPre: boolean,
): number {
  let cursor = firstLine
  for (let at = start; at < list.length; at++) {
    const node = list[at]
    if (typeof node === 'string') {
      if (inPre) addCode(state, node)
      else addText(state, node)
      cursor += countNewlines(node)
    } else if (Array.isArray(node)) {
      cursor = visit(state, list, at, node, cursor, depth, inPre)
    }
  }
  return cursor
}

function visit(
  state: State,
  list: unknown[],
  at: number,
  node: unknown[],
  cursor: number,
  depth: number,
  inPre: boolean,
): number {
  if (depth > MAX_DEPTH) {
    state.problem ??= 'nesting'
    return cursor
  }
  const tag: unknown = node[0]
  let props: Props
  if (isProps(node[1])) {
    props = node[1]
  } else {
    props = {}
    node[1] = props
  }
  const open = takeLine(props, OPEN_KEY, state.options.lineOffset)
  const content = takeLine(props, LINE_KEY, state.options.lineOffset)
  const line = open ?? content ?? cursor
  if (state.leftOut.size > 0) takeProps(state, props)

  if (typeof tag !== 'string') {
    list[at] = markerNode('raw-html', '!--', line, [])
    record(state, 'raw-html', '!--', line)
    state.inWord = false
    return line
  }
  if (tag.startsWith(RAW_HTML_PREFIX)) {
    const name = tag.slice(RAW_HTML_PREFIX.length)
    list[at] = markerNode('raw-html', name, line, [])
    record(state, 'raw-html', name, line)
    state.inWord = false
    return line
  }
  const native = NATIVE_TAGS.has(tag)
  if (!native && !state.options.components.has(tag)) {
    const marker = markerNode('unknown-component', tag, line, node.slice(2))
    list[at] = marker
    record(state, 'unknown-component', tag, line)
    state.inWord = false
    const end = walk(state, marker, 2, content ?? line, depth + 1, inPre)
    state.inWord = false
    return end
  }

  cleanProps(state, tag, props, native, line)
  if (tag === 'span') bracket(node)
  if (!native) state.components.push({ name: tag, props: decodeProps(props), line })
  if (tag === 'a') collectLink(state, props, line)
  else if (tag === 'img') collectImage(state, props, line)

  const inline = INLINE_TAGS.has(tag)
  if (!inline) {
    state.inWord = false
    state.inCodeWord = false
  }
  if (tag === 'br') return line + 1
  const end = walk(state, node, 2, content ?? line, depth + 1, inPre || tag === 'pre')
  if (!inline) state.inWord = false

  const level = HEADING_LEVEL.get(tag)
  if (level !== undefined) {
    const text = plainText(node, depth)
    const id = state.ids.next(text)
    props.id = id
    state.headings.push({ depth: level, text, id, line })
  }
  return end
}

export function analyzeDocument(document: MarkdownDocument, options: AnalyzeOptions): Analysis {
  const state: State = {
    options,
    leftOut: takeLeftOut(document.nodes, options.lineOffset),
    taken: new Set(),
    headings: [],
    links: [],
    images: [],
    components: [],
    disallowed: [],
    reported: new Set(),
    ids: new HeadingIds(),
    words: 0,
    inWord: false,
    codeWords: 0,
    inCodeWord: false,
    problem: undefined,
  }
  walk(state, document.nodes, 0, options.lineOffset + 1, 1, false)
  for (const [id, item] of state.leftOut) {
    if (!item.given || !state.taken.has(id)) {
      record(state, 'disallowed-attribute', `${item.tag}[${item.text}]`, item.line)
    }
  }
  state.disallowed.sort((a, b) => (a.line ?? 0) - (b.line ?? 0))
  return {
    extracted: {
      headings: state.headings,
      links: state.links,
      images: state.images,
      components: state.components,
      words: state.words,
      codeWords: state.codeWords,
      disallowed: state.disallowed,
    },
    problem: state.problem,
  }
}
