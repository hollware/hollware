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

/*
 * The analysis: one walk over the document Comark made, which judges it (ADR-020) and extracts
 * what the contracts need from it. It changes the document in place, so that what is stored
 * holds only what the policy lets through:
 * - an element that is raw HTML, or a component the collection does not declare, becomes a
 *   `hollware-marker`, which keeps the children of the component, so that a typo in a name is a
 *   marker and not a missing paragraph;
 * - an attribute outside the allowlist of its tag, and a URL with a scheme that is not allowed,
 *   are taken off their element;
 * - heading ids are Hollware's own, and the line each block starts on is taken off its props.
 * Everything it changes is also reported in `disallowed`, so that nothing is dropped silently,
 * and so is the text that Comark's syntax left out before this walk began (see `parser.ts`).
 *
 * Comark's `security` plugin is not used, although ADR-020 names it and its `tagFallback`. It is
 * a post hook of the parser, so it would run before this walk and take off the attributes it
 * dislikes without a word, and nothing could be reported; it compares tag names without regard to
 * case and needs the names of the alerts in its list, which lets `::tip` through as an element;
 * and once this walk is done there is nothing left for it to find.
 */

type Props = Record<string, unknown>

export interface AnalyzeOptions {
  /** The components the collection declares. */
  readonly components: ReadonlySet<string>
  readonly routes: readonly CompiledRoute[]
  /** How many lines the frontmatter took, so that the first line of the body is `lineOffset + 1`. */
  readonly lineOffset: number
}

/** Why a document cannot be stored: nested too deeply, or a prop that is not JSON. */
export type Problem = 'nesting' | 'props'

export interface Analysis {
  readonly extracted: ExtractedContent
  readonly problem: Problem | undefined
}

/** Text that Comark's syntax took and left out of the document, which the markdown-it rule listed. */
interface LeftOut {
  readonly line: number
  /** The block it is in. */
  readonly tag: string
  /** Whether Comark read it as attributes, which an element may have taken. */
  readonly given: boolean
  readonly text: string
}

interface State {
  readonly options: AnalyzeOptions
  /** What was left out, by the number the attribute `$p<n>` gives it. */
  readonly leftOut: ReadonlyMap<number, LeftOut>
  /** The numbers of the ones that an element took as its attributes. */
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

/** What `\s` matches, which is what separates the words of a text. */
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

/** The text of a node, without its marks. */
function plainText(node: readonly unknown[], depth: number): string {
  let text = ''
  for (let at = 2; at < node.length; at++) {
    const child = node[at]
    if (typeof child === 'string') text += child
    else if (Array.isArray(child) && depth < MAX_DEPTH) text += plainText(child, depth + 1)
  }
  return text
}

/** Takes the line the markdown-it rule left in the props under `key`, as a line of the file, or `undefined`. */
function takeLine(props: Props, key: string, lineOffset: number): number | undefined {
  if (!Object.hasOwn(props, key)) return undefined
  const value = props[key]
  delete props[key]
  const line = typeof value === 'string' ? Number.parseInt(value, 10) : Number.NaN
  return Number.isSafeInteger(line) && line >= 0 ? line + 1 + lineOffset : undefined
}

/** Reads and removes the node at the end of the document that lists what was left out. */
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

/** Removes the attributes that name the `{...}` an element took, and remembers which. */
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

/** The props of a component as its schema should see them: Comark stores `{open}` as `":open": "true"`. */
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

/** What kind of URL an attribute holds, if it holds one. */
function urlKind(tag: string, key: string, native: boolean): UrlKind | undefined {
  if (native) {
    if (tag === 'a' && key === 'href') return 'link'
    return tag === 'img' && key === 'src' ? 'image' : undefined
  }
  const name = attributeName(key)
  // A component's prop that a site binds to a link or an image by its name: `href`, `to` (a
  // router link), `url`, `link`, and any name that ends in href, url or src (`ctaUrl`,
  // `imageSrc`). Its schema may take any string; `javascript:` is never one a site should get.
  if (name === 'to' || name === 'link' || /(?:href|url)$/.test(name)) return 'link'
  return name.endsWith('src') ? 'image' : undefined
}

/**
 * Takes off an element every attribute its tag may not carry and every URL it may not point
 * to. A native tag has an allowlist (`policy.ts`). A component takes the props its schema
 * declares, which only the contracts know, so here it loses only what is never safe: event
 * handlers, attributes that write HTML and unsafe `href` and `src`.
 */
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

/**
 * Gives a span back the brackets Comark took off it. Comark reads `[text]` as a span, for
 * `[text]{.class}`, and prints the text without the brackets, so `array[0]` would read `array0`.
 * Hollware allows no attribute on a span, so a span is always text that had brackets.
 */
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

/**
 * Judges the children of a node, in order, and returns the line the next sibling starts on.
 * A line is counted from the block that carries it: every line break in the text (a soft break)
 * and every hard break moves it down one.
 */
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
      if (!inPre) addText(state, node)
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
    // A comment node. Only Comark's `html` plugin makes one, and it is not registered.
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
  if (!inline) state.inWord = false
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

/**
 * Judges and extracts a document: see the comment at the top of this file. The `words` are
 * the whitespace-separated words of the text outside code blocks, with the headings, the list
 * items, the link text and the text inside components, and without URLs and the marks of Markdown.
 */
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
    problem: undefined,
  }
  walk(state, document.nodes, 0, options.lineOffset + 1, 1, false)
  for (const [id, item] of state.leftOut) {
    // Braces that an element took as attributes are judged with the element; the rest was lost.
    if (!item.given || !state.taken.has(id)) {
      record(state, 'disallowed-attribute', `${item.tag}[${item.text}]`, item.line)
    }
  }
  // In the order of the file: the walk finds the elements first, and what was left out last.
  state.disallowed.sort((a, b) => (a.line ?? 0) - (b.line ?? 0))
  return {
    extracted: {
      headings: state.headings,
      links: state.links,
      images: state.images,
      components: state.components,
      words: state.words,
      disallowed: state.disallowed,
    },
    problem: state.problem,
  }
}
