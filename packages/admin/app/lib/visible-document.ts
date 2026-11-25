type Node = string | readonly unknown[]

const HTML_TAGS: ReadonlySet<string> = new Set([
  'a',
  'blockquote',
  'br',
  'code',
  'del',
  'div',
  'em',
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
  'hr',
  'img',
  'input',
  'li',
  'ol',
  'p',
  'pre',
  'span',
  'strong',
  'table',
  'tbody',
  'td',
  'th',
  'thead',
  'tr',
  'ul',
])

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

const INLINE_PARENTS: ReadonlySet<string> = new Set([
  'a',
  'del',
  'em',
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
  'p',
  'span',
  'strong',
  'td',
  'th',
])

function propsText(props: Record<string, unknown>): string {
  return Object.entries(props)
    .filter(([key]) => key !== '$')
    .map(
      ([key, value]) =>
        `${key.replace(/^:/, '')}=${typeof value === 'string' ? value : JSON.stringify(value)}`,
    )
    .join(' ')
}

function visibleNode(node: unknown, inline = false): unknown {
  if (!Array.isArray(node) || typeof node[0] !== 'string') return node
  const [tag, rawProps, ...children] = node as [string, unknown, ...unknown[]]
  const props = isRecord(rawProps) ? rawProps : {}
  if (tag === 'template') {
    const name = typeof props['name'] === 'string' ? props['name'] : 'default'
    return [
      'div',
      { class: 'hw-preview-slot', 'data-slot': name },
      ...(name === 'default' ? [] : [['p', { class: 'hw-preview-slot-name' }, `#${name}`]]),
      ...children.map((child) => visibleNode(child)),
    ]
  }
  if (HTML_TAGS.has(tag)) {
    const inside = INLINE_PARENTS.has(tag)
    return [tag, rawProps, ...children.map((child) => visibleNode(child, inside))]
  }
  if (inline) {
    return [
      'span',
      { class: 'hw-preview-inline', 'data-component': tag },
      ...children.map((child) => visibleNode(child, true)),
    ]
  }
  const summary = propsText(props)
  return [
    'section',
    { class: 'hw-preview-block', 'data-component': tag },
    ['p', { class: 'hw-preview-name' }, summary === '' ? tag : `${tag} ${summary}`],
    ...children.map((child) => visibleNode(child)),
  ]
}

export function visibleDocument(document: unknown): unknown {
  if (!isRecord(document) || !Array.isArray(document['nodes'])) return document
  return { ...document, nodes: (document['nodes'] as Node[]).map((node) => visibleNode(node)) }
}
