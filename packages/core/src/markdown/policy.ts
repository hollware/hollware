/**
 * What the pipeline lets through (ADR-020): the tags Markdown itself produces, the attributes each
 * of them may carry and the URLs that links and images may point to. The write path
 * (`analyze.ts`) applies these rules and reports whatever it removes; `renderHtml` applies the
 * ones that matter for safety once more to any document it is given.
 */

/** The tag of the element that stands in the document for something the pipeline did not let through. */
export const MARKER_TAG = 'hollware-marker'

/**
 * The prefix of the tag the markdown-it rule gives raw HTML (`hollware-raw:script`). Component
 * syntax cannot write a colon in a tag name, so no author can forge one, and the analysis turns
 * every such element into a marker.
 */
export const RAW_HTML_PREFIX = 'hollware-raw:'

/**
 * The tag of the node the markdown-it rule adds at the end of the document, which lists the text
 * that Comark's syntax read as attributes or parameters and left out of the document: the
 * analysis reads it, reports what it holds and removes it. Like `hollware-raw:`, it has a colon,
 * which component syntax cannot write.
 */
export const LEFT_OUT_TAG = 'hollware-left-out:'

/**
 * The key of an attribute that names one `{...}` (`$p0`, `$p1`): it travels from the token to the
 * element that took the braces as its attributes, which tells the analysis that they were taken.
 */
export const PROPS_KEY = /^\$p(\d+)$/

/** The attribute that carries the line of a block from the markdown-it rule to the analysis, which removes it. */
export const LINE_KEY = '$line'

/**
 * The same for a component, whose line is the one it opens on. A component with a single
 * paragraph is unwrapped by Comark, which merges the paragraph's props into it: the paragraph's
 * `$line` then says where the content starts, and `$open` where the component does.
 */
export const OPEN_KEY = '$open'

/** The deepest nesting of elements, and of the JSON values in props and frontmatter, that is stored. */
export const MAX_DEPTH = 100

/** The tags Markdown itself produces, plus the slot wrapper `template` and the task list checkbox `input`. */
export const NATIVE_TAGS: ReadonlySet<string> = new Set([
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
  'p',
  'a',
  'img',
  'ul',
  'ol',
  'li',
  'pre',
  'code',
  'table',
  'thead',
  'tbody',
  'tr',
  'th',
  'td',
  'blockquote',
  'hr',
  'br',
  'strong',
  'em',
  'del',
  'span',
  'input',
  'template',
])

/** The tags that sit inside a line of text: they do not end a word, which a block does. */
export const INLINE_TAGS: ReadonlySet<string> = new Set([
  'a',
  'img',
  'code',
  'strong',
  'em',
  'del',
  'span',
  'input',
])

/** The kinds of alert a blockquote can be (`> [!NOTE]`). */
export const ALERT_TYPES: readonly string[] = ['note', 'tip', 'important', 'warning', 'caution']

type ValueRule = (value: unknown) => boolean

const text: ValueRule = (value) => typeof value === 'string'
const exactly =
  (...allowed: readonly string[]): ValueRule =>
  (value) =>
    typeof value === 'string' && allowed.includes(value)
const matching =
  (pattern: RegExp): ValueRule =>
  (value) =>
    typeof value === 'string' && pattern.test(value)

/** Only `language-*` classes, which is what a fenced code block carries. */
const languageClasses: ValueRule = (value) => {
  if (typeof value !== 'string') return false
  const names = value.split(/\s+/).filter((name) => name !== '')
  return names.length > 0 && names.every((name) => /^language-[\w+#.-]+$/.test(name))
}

const lineNumbers: ValueRule = (value) =>
  Array.isArray(value) && value.every((line: unknown) => Number.isSafeInteger(line))

const alignment = new Map<string, ValueRule>([
  ['style', exactly('text-align:left', 'text-align:right', 'text-align:center')],
])

/**
 * The attributes each native tag may carry, with the values it may have. The headings carry none:
 * their ids are Hollware's own. The classes, the alert and the table alignment are what Comark
 * and markdown-it add themselves, so a document the parser writes passes its own rules.
 */
const ATTRIBUTE_RULES: ReadonlyMap<string, ReadonlyMap<string, ValueRule>> = new Map([
  [
    'a',
    new Map([
      ['href', text],
      ['title', text],
    ]),
  ],
  [
    'img',
    new Map([
      ['src', text],
      ['alt', text],
      ['title', text],
      ['width', text],
      ['height', text],
    ]),
  ],
  ['code', new Map([['class', languageClasses]])],
  [
    'pre',
    new Map([
      ['language', text],
      ['filename', text],
      ['highlights', lineNumbers],
      ['meta', text],
    ]),
  ],
  ['ol', new Map([['start', matching(/^\d{1,9}$/)]])],
  ['ul', new Map([['class', exactly('contains-task-list')]])],
  ['li', new Map([['class', exactly('task-list-item')]])],
  ['blockquote', new Map([['as', exactly(...ALERT_TYPES)]])],
  ['th', alignment],
  ['td', alignment],
  [
    'input',
    new Map([
      ['class', exactly('task-list-item-checkbox')],
      ['type', exactly('checkbox')],
      [':disabled', exactly('true')],
      [':checked', exactly('true')],
    ]),
  ],
  ['template', new Map([['name', matching(/^[\w-]+$/)]])],
])

/** Whether a native tag may carry the attribute with that value. */
export function isAllowedAttribute(tag: string, key: string, value: unknown): boolean {
  const rule = ATTRIBUTE_RULES.get(tag)?.get(key)
  return rule !== undefined && rule(value)
}

/** The attribute as an author wrote it: Comark stores `{open}` as `:open`. */
export function displayAttribute(key: string): string {
  return key.startsWith(':') ? key.slice(1) : key
}

/**
 * The name of an attribute as a browser or a framework will see it: Comark keeps `:name` for
 * bindings and Vue spells a handler `@click` or `v-on:click`, so those prefixes go before the name
 * is judged.
 */
export function attributeName(key: string): string {
  return key
    .toLowerCase()
    .replace(/^(?::|v-bind:)/, '')
    .replace(/^(?:@|v-on:)/, 'on')
    .replaceAll(':', '')
}

const SINK_NAMES: ReadonlySet<string> = new Set([
  'srcdoc',
  'formaction',
  'innerhtml',
  'dangerouslysetinnerhtml',
  'textcontent',
])

/**
 * An attribute no element may carry: an event handler (every name that starts with `on`, which
 * is also what Vue reads as a listener) or one that writes HTML.
 */
export function isForbiddenAttribute(name: string): boolean {
  return name.startsWith('on') || SINK_NAMES.has(name)
}

const NAMED_ENTITY = new Map([
  ['colon', ':'],
  ['Tab', '\t'],
  ['NewLine', '\n'],
])

/** The character references a URL can hide its scheme behind, decoded the way an HTML renderer that does not escape them would leave them for a browser. */
function decodeEntities(value: string): string {
  let current = value
  for (let pass = 0; pass < 3; pass++) {
    const next = current.replace(
      /&(?:#[xX]([0-9a-fA-F]+)|#(\d+)|(colon|Tab|NewLine));?/g,
      (
        match: string,
        hex: string | undefined,
        decimal: string | undefined,
        name: string | undefined,
      ) => {
        if (name !== undefined) return NAMED_ENTITY.get(name) ?? match
        const code =
          hex !== undefined ? Number.parseInt(hex, 16) : Number.parseInt(decimal ?? '', 10)
        return Number.isFinite(code) && code <= 0x10ffff ? String.fromCodePoint(code) : match
      },
    )
    if (next === current) break
    current = next
  }
  return current
}

/** Drops the control characters and spaces at the start of a URL, which a browser ignores. */
export function trimLeadingControls(value: string): string {
  let at = 0
  while (at < value.length && value.charCodeAt(at) <= 0x20) at++
  return value.slice(at)
}

/**
 * The scheme of a URL as a browser reads it, in lowercase, or `undefined` for a relative URL.
 * A browser drops the control characters and spaces at the start, and every tab and line break,
 * before it reads the scheme, and it reads a character reference in an attribute: `jav&#9;ascript:`
 * is `javascript:`.
 */
export function urlScheme(value: string): string | undefined {
  const decoded = value.includes('&') ? decodeEntities(value) : value
  const colon = decoded.indexOf(':')
  if (colon === -1) return undefined
  const head = trimLeadingControls(decoded.slice(0, colon).replace(/[\t\n\r]/g, ''))
  return /^[A-Za-z][A-Za-z0-9+.-]*$/.test(head) ? head.toLowerCase() : undefined
}

export type UrlKind = 'link' | 'image'

const LINK_SCHEMES: ReadonlySet<string> = new Set(['http', 'https', 'mailto'])
const IMAGE_SCHEMES: ReadonlySet<string> = new Set(['http', 'https'])

/**
 * Whether a link or an image may point there. A relative URL (a path, `#anchor`, `?query` or
 * `//host/path`) is always safe: it keeps the scheme of the page. Of the schemes, links may use
 * `http`, `https` and `mailto`, and images `http` and `https`.
 */
export function isSafeUrl(value: string, kind: UrlKind): boolean {
  const scheme = urlScheme(value)
  return scheme === undefined || (kind === 'link' ? LINK_SCHEMES : IMAGE_SCHEMES).has(scheme)
}

const NAME_LENGTH = 100

/** A tag, attribute or URL as a marker names it: long values, such as a `data:` URL, are cut. */
export function shorten(value: string): string {
  return value.length > NAME_LENGTH ? `${value.slice(0, NAME_LENGTH - 3)}...` : value
}

/** Defines an own property, so that a prop called `__proto__` is a prop and not a prototype. */
export function setOwn(target: Record<string, unknown>, key: string, value: unknown): void {
  Object.defineProperty(target, key, {
    value,
    enumerable: true,
    writable: true,
    configurable: true,
  })
}

/** Reads a string as JSON, or gives it back when it is not JSON (or is a number that JSON cannot hold). */
export function parseJson(value: string): unknown {
  try {
    const parsed: unknown = JSON.parse(value)
    return typeof parsed === 'number' && !Number.isFinite(parsed) ? value : parsed
  } catch {
    return value
  }
}

/** Comark stores a prop that holds data, such as `{open}` or `{:count="3"}`, under `:name`. */
export function isBinding(key: string): boolean {
  return key.startsWith(':') || key.startsWith('v-bind:')
}

/** The URL an attribute holds, or `undefined` when it holds a value that cannot be one. */
export function urlValue(key: string, value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  if (!isBinding(key)) return value
  // A binding such as `:href='"https://…"'` holds the URL as JSON; one such as `:href="page.url"` is a path into the data.
  const parsed = parseJson(value)
  return typeof parsed === 'string' ? parsed : value
}
