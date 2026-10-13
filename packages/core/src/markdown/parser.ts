import type { ComarkPlugin, MarkdownDocument } from 'comark'
import { LEFT_OUT_TAG, LINE_KEY, OPEN_KEY, RAW_HTML_PREFIX } from './policy.ts'

/*
 * The parser: Comark with the plugins Markdown and components need and Hollware's own markdown-it
 * rule (ADR-020). Comark is imported when the first Markdown arrives, never before, so an
 * isolate that only reads never loads it. There is one parser per isolate: it does not depend on
 * the components of a collection, which the analysis checks afterwards, and it keeps nothing
 * between two calls, so any number of writes can use it at once.
 */

/**
 * The few members of markdown-exit's tokens, rules and parser that the rule below uses.
 * markdown-exit is not a dependency of core: Comark brings it and hands a plugin its parser.
 */
interface Token {
  type: string
  tag: string
  nesting: number
  attrs: [string, string][] | null
  map: [number, number] | null
  content: string
  children: Token[] | null
}

interface CoreState {
  src: string
  tokens: Token[]
  Token: new (type: string, tag: string, nesting: number) => Token
}

interface InlineState {
  pos: number
  src: string
  tokens: Token[]
}

interface MarkdownIt {
  set(options: { html: boolean }): unknown
  validateLink: (url: string) => boolean
  linkify: { set(options: { fuzzyLink: boolean }): unknown }
  block: { ruler: { disable(name: string): unknown } }
  inline: {
    ruler: { at(name: string, rule: (state: InlineState, silent: boolean) => boolean): unknown }
  }
  core: { ruler: { push(name: string, rule: (state: CoreState) => void): unknown } }
}

/** The block tokens whose attributes reach the node, so that the line they start on can travel with them. */
const LINE_TOKENS: ReadonlySet<string> = new Set([
  'paragraph_open',
  'heading_open',
  'blockquote_open',
  'bullet_list_open',
  'ordered_list_open',
  'list_item_open',
  'table_open',
  'thead_open',
  'tbody_open',
  'tr_open',
])

/** The tokens of a component, whose line is kept apart from the line of its content. */
const OPEN_TOKENS: ReadonlySet<string> = new Set(['mdc_block_open', 'mdc_block_shorthand'])

const TAG_NAME = /^\s*<\/?([A-Za-z][A-Za-z0-9-]*)/
const DECLARATION = /^\s*<!([A-Za-z]+)/

/** What a piece of raw HTML is called in a marker: its tag, or `!--` for a comment, `?` for an instruction. */
function rawHtmlName(content: string): string {
  const tag = TAG_NAME.exec(content)?.[1]
  if (tag !== undefined) return tag.toLowerCase()
  const start = content.trimStart()
  if (start.startsWith('<!--')) return '!--'
  if (start.startsWith('<![CDATA[')) return '![cdata['
  const declaration = DECLARATION.exec(start)?.[1]
  return declaration === undefined ? '?' : `!${declaration.toLowerCase()}`
}

function skipSpaces(text: string, from: number): number {
  let at = from
  while (text[at] === ' ' || text[at] === '\t') at++
  return at
}

/** The `]` that closes the `[` at `open`, with Comark's rules: a backslash hides a character and brackets nest. */
function closingBracket(text: string, open: number): number {
  let depth = 0
  for (let at = open + 1; at < text.length; at++) {
    const char = text[at]
    if (char === '\\') {
      at++
    } else if (char === '[') {
      depth++
    } else if (char === ']') {
      if (depth === 0) return at
      depth--
    }
  }
  return -1
}

/** The `}` that closes the `{` at `open`: quotes hide their braces, and braces nest. */
function closingBrace(text: string, open: number): number {
  let depth = 0
  for (let at = open + 1; at < text.length; at++) {
    const char = text[at]
    if (char === '\\') {
      at++
    } else if (char === '"' || char === "'" || char === '`') {
      let end = at + 1
      while (end < text.length && text[end] !== char) end += text[end] === '\\' ? 2 : 1
      if (end >= text.length) return -1
      at = end
    } else if (char === '{') {
      depth++
    } else if (char === '}') {
      if (depth === 0) return at
      depth--
    }
  }
  return -1
}

/**
 * The text that follows the name, the `[content]` and the `{props}` on the line that opens a
 * component (`::callout{type="tip"} and this`). Comark takes the line for the component and
 * leaves what follows out of the document. It is empty when there is nothing after them, and
 * when the line is too odd to tell where they end.
 */
function openTail(line: string): string {
  const fence = line.indexOf('::')
  if (fence === -1) return ''
  let at = fence
  while (line[at] === ':') at++
  at = skipSpaces(line, at)
  const name = /^[A-Za-z$][$\w.-]*/.exec(line.slice(at))
  if (name === null) return ''
  at = skipSpaces(line, at + name[0].length)
  if (line[at] === '[') {
    const close = closingBracket(line, at)
    if (close === -1) return ''
    at = skipSpaces(line, close + 1)
  }
  if (line[at] === '{') {
    const close = closingBrace(line, at)
    if (close === -1) return ''
    at = skipSpaces(line, close + 1)
  }
  return line.slice(at).trim()
}

/**
 * Runs once the block and inline rules have made their tokens. It leaves no token that the
 * analysis could not judge:
 * - Raw HTML becomes an element no author can write (`hollware-raw:script`), so the content of
 *   the tag never reaches the document and the analysis can report it with its line.
 * - A block that Comark turns into a node gets the line it starts on, for the same reason.
 * - A link reference definition, which the links that use it have already read, leaves no token:
 *   Comark would make an empty `component` node of it.
 * - Text that Comark's syntax takes and leaves out of the document is listed in a node at the
 *   end of the document, for the analysis to report: every `{...}` (Comark reads it as
 *   attributes, and drops it wherever no element takes them, which includes any `{` in prose that
 *   is not closed), and whatever follows the parameters on the line that opens a component.
 */
function rewriteTokens(state: CoreState): void {
  const { tokens } = state
  // One entry for each: the line (from 0), the block it is in, whether it was read as attributes, and its text.
  const leftOut: [string, string, string, string][] = []
  let lines: string[] | undefined
  let blockTag = 'p'
  let blockLine = 0
  let kept = 0
  for (let at = 0; at < tokens.length; at++) {
    const token = tokens[at]
    if (token === undefined || token.type === 'reference') continue
    if (token.map !== null) blockLine = token.map[0]
    if (token.nesting === 1 && token.tag !== '') blockTag = token.tag
    if (token.type === 'html_block') {
      const raw = new state.Token(
        'hollware_raw_html',
        RAW_HTML_PREFIX + rawHtmlName(token.content),
        0,
      )
      if (token.map !== null) raw.attrs = [[LINE_KEY, String(token.map[0])]]
      tokens[kept++] = raw
      continue
    }
    if (token.type === 'inline' && token.children !== null) {
      const { children } = token
      let line = blockLine
      for (let child = 0; child < children.length; child++) {
        const inner = children[child]
        if (inner === undefined) continue
        if (inner.type === 'html_inline') {
          children[child] = new state.Token(
            'mdc_inline_component',
            RAW_HTML_PREFIX + rawHtmlName(inner.content),
            0,
          )
        } else if (inner.type === 'mdc_inline_props') {
          // The attribute travels to the element that takes the braces, and tells the analysis that one did.
          const given = inner.attrs !== null && inner.attrs.length > 0
          inner.attrs ??= []
          inner.attrs.push([`$p${leftOut.length}`, '1'])
          leftOut.push([String(line), blockTag, given ? '1' : '0', inner.content])
        } else if (inner.type === 'softbreak' || inner.type === 'hardbreak') {
          line++
        }
      }
    } else if (token.map !== null && token.nesting >= 0) {
      const key = OPEN_TOKENS.has(token.type)
        ? OPEN_KEY
        : LINE_TOKENS.has(token.type)
          ? LINE_KEY
          : undefined
      if (key !== undefined) {
        token.attrs ??= []
        token.attrs.push([key, String(token.map[0])])
      }
      if (token.type === 'mdc_block_open') {
        lines ??= state.src.split('\n')
        const tail = openTail(lines[token.map[0]] ?? '')
        if (tail !== '') leftOut.push([String(token.map[0]), token.tag, '0', tail])
      }
    }
    tokens[kept++] = token
  }
  tokens.length = kept
  if (leftOut.length > 0) {
    const list = new state.Token('hollware_left_out', LEFT_OUT_TAG, 0)
    list.attrs = leftOut.map((entry, id) => [`$p${id}`, entry.join('\u0000')])
    tokens.push(list)
  }
}

/**
 * Keeps the text of every `{...}` that Comark reads as attributes in the content of its token,
 * which Comark leaves empty, so that the analysis can say what was left out. The rule is
 * Comark's own, found by its name in the rules of markdown-it.
 */
function keepPropsText(md: MarkdownIt): void {
  const rules: unknown = Reflect.get(md.inline.ruler, '__rules__')
  const rule: unknown = Array.isArray(rules)
    ? rules.find(
        (entry: unknown) =>
          typeof entry === 'object' &&
          entry !== null &&
          Reflect.get(entry, 'name') === 'comark_inline_props',
      )
    : undefined
  const original: unknown =
    typeof rule === 'object' && rule !== null ? Reflect.get(rule, 'fn') : undefined
  if (typeof original !== 'function') {
    throw new Error('Comark no longer has the inline rule `comark_inline_props`')
  }
  md.inline.ruler.at('comark_inline_props', (state, silent) => {
    const start = state.pos
    const matched = Reflect.apply(original, undefined, [state, silent]) === true
    if (matched && !silent) {
      const token = state.tokens[state.tokens.length - 1]
      if (token?.type === 'mdc_inline_props') token.content = state.src.slice(start, state.pos)
    }
    return matched
  })
}

/**
 * Hollware's settings for Comark's markdown-it:
 * - `html` is on only so that raw HTML is tokenized, never parsed: the rule above replaces it.
 * - Any destination is let through, so that a link or an image with an unsafe URL is a link
 *   the analysis can report, not text that Markdown left behind without a word.
 * - A bare `README.md` is not a link to the host `readme.md`; `https://…` and e-mail addresses
 *   still are.
 * - A component takes its props in `{...}`. The YAML block form (`---` under the component)
 *   is off: its anchors and aliases can build a value of billions of nodes, and Comark writes
 *   that value out as JSON while it parses: a file of 1 KB cost it 9.5 seconds of CPU with seven
 *   levels of anchors and more than 40 with nine.
 */
function hollwareMarkdownIt(md: MarkdownIt): void {
  md.set({ html: true })
  md.validateLink = () => true
  md.linkify.set({ fuzzyLink: false })
  md.block.ruler.disable('comark_block_yaml')
  keepPropsText(md)
  md.core.ruler.push('hollware', rewriteTokens)
}

const hollware: ComarkPlugin = { name: 'hollware', markdownItPlugins: [hollwareMarkdownIt] }

export interface Parser {
  /** Splits the frontmatter off, with Comark's own function. YAML that does not parse throws a `YAMLException`. */
  splitFrontmatter(markdown: string): { content: string; data: unknown }
  /** Parses a Markdown body into Comark's document, which the analysis then judges. */
  parseBody(markdown: string): Promise<MarkdownDocument>
}

async function createParser(): Promise<Parser> {
  const [comark, components, attributes, taskList, alert] = await Promise.all([
    import('comark'),
    import('comark/plugins/components'),
    import('comark/plugins/attributes'),
    import('comark/plugins/task-list'),
    import('comark/plugins/alert'),
  ])
  const parse = comark.createMarkdownParser({
    // Streaming completes what an author left open and is quadratic on hostile input.
    autoClose: false,
    // Only the plugins below: never `html` (ADR-020), and no emoji, math or footnotes.
    registerDefaultPlugins: false,
    // The ids are Hollware's own (`slug.ts`).
    headingIds: false,
    plugins: [
      components.default(),
      attributes.default(),
      taskList.default(),
      hollware,
      alert.default(),
    ],
  })
  return {
    splitFrontmatter: (markdown) => comark.parseFrontmatter(markdown),
    parseBody: (markdown) => parse(markdown),
  }
}

let parser: Promise<Parser> | undefined

/** The parser of this isolate, built the first time it is asked for. */
export function getParser(): Promise<Parser> {
  parser ??= createParser().catch((error: unknown) => {
    // A failed import must not poison every later write.
    parser = undefined
    throw error
  })
  return parser
}
