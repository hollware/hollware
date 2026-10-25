import type { JSONContent } from '@tiptap/core'
import type { ElementNode, Node as ComarkNode } from 'comark'

type Props = Record<string, unknown>
type Mark = NonNullable<JSONContent['marks']>[number]

const INLINE_TAGS: ReadonlySet<string> = new Set(['strong', 'em', 'del', 'code', 'a', 'img', 'br'])
const MARKS: Readonly<Record<string, string>> = {
  strong: 'bold',
  em: 'italic',
  del: 'strike',
  code: 'code',
  a: 'link',
}
const TAGS: Readonly<Record<string, string>> = Object.fromEntries(
  Object.entries(MARKS).map(([tag, mark]) => [mark, tag]),
)
const BLOCK_TAGS: ReadonlySet<string> = new Set([
  'p',
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
  'ul',
  'ol',
  'li',
  'blockquote',
  'pre',
  'hr',
  'table',
  'template',
])
const TASK_LIST = 'contains-task-list'
const TASK_ITEM = 'task-list-item'

function isElement(node: ComarkNode): node is ElementNode {
  return Array.isArray(node) && typeof node[0] === 'string'
}

function isHtml(node: ElementNode): boolean {
  return node[1].$?.html === 1
}

function propsOf(node: ElementNode, known: readonly string[] = []): Props | null {
  const props: Props = {}
  for (const [key, value] of Object.entries(node[1])) {
    if (key !== '$' && !known.includes(key)) props[key] = value
  }
  return Object.keys(props).length === 0 ? null : props
}

function childrenOf(node: ElementNode): ComarkNode[] {
  return node.slice(2) as ComarkNode[]
}

function isInline(node: ComarkNode): boolean {
  if (typeof node === 'string') return true
  if (!isElement(node)) return false
  if (isHtml(node)) return node[1].$?.block !== 1
  return INLINE_TAGS.has(node[0])
}

function raw(node: ComarkNode, inline: boolean): JSONContent {
  return { type: inline ? 'comarkInline' : 'comarkBlock', attrs: { node } }
}

function textOf(node: ElementNode): string {
  let text = ''
  for (const child of childrenOf(node)) {
    text += typeof child === 'string' ? child : isElement(child) ? textOf(child) : ''
  }
  return text
}

function inlineToEditor(nodes: readonly ComarkNode[], marks: readonly Mark[] = []): JSONContent[] {
  const content: JSONContent[] = []
  for (const node of nodes) {
    if (typeof node === 'string') {
      if (node !== '')
        content.push(
          marks.length > 0
            ? { type: 'text', text: node, marks: [...marks] }
            : { type: 'text', text: node },
        )
      continue
    }
    if (!isElement(node) || isHtml(node)) {
      content.push(raw(node, true))
      continue
    }
    const [tag] = node
    const mark = MARKS[tag]
    if (tag === 'code') {
      const text = textOf(node)
      const code: Mark = { type: 'code', attrs: { props: propsOf(node) } }
      if (text !== '') content.push({ type: 'text', text, marks: [...marks, code] })
    } else if (mark !== undefined) {
      const attrs: Props =
        mark === 'link'
          ? {
              href: node[1]['href'] ?? '',
              title: node[1]['title'] ?? null,
              props: propsOf(node, ['href', 'title']),
            }
          : { props: propsOf(node) }
      content.push(...inlineToEditor(childrenOf(node), [...marks, { type: mark, attrs }]))
    } else if (tag === 'img') {
      content.push({
        type: 'image',
        attrs: {
          src: node[1]['src'] ?? '',
          alt: node[1]['alt'] ?? '',
          title: node[1]['title'] ?? null,
          props: propsOf(node, ['src', 'alt', 'title']),
        },
        ...(marks.length > 0 ? { marks: [...marks] } : {}),
      })
    } else if (tag === 'br') {
      content.push({ type: 'hardBreak' })
    } else {
      content.push(raw(node, true))
    }
  }
  return content
}

function paragraph(inline: readonly ComarkNode[], props: Props | null = null): JSONContent {
  const content = inlineToEditor(inline)
  const attrs = props === null ? {} : { attrs: { props } }
  return content.length === 0
    ? { type: 'paragraph', ...attrs }
    : { type: 'paragraph', ...attrs, content }
}

function isBlock(node: ComarkNode): boolean {
  if (!isElement(node)) return false
  if (isHtml(node)) return node[1].$?.block === 1
  return BLOCK_TAGS.has(node[0])
}

function blocksToEditor(nodes: readonly ComarkNode[]): JSONContent[] {
  const blocks: JSONContent[] = []
  const inlineContext = nodes.some(isInline)
  let inline: ComarkNode[] = []
  const flush = () => {
    if (inline.length > 0) blocks.push(paragraph(inline))
    inline = []
  }
  for (const node of nodes) {
    if (isInline(node) || (inlineContext && !isBlock(node))) {
      inline.push(node)
      continue
    }
    flush()
    blocks.push(blockToEditor(node))
  }
  flush()
  return blocks
}

function containerContent(node: ElementNode): JSONContent[] {
  const content = blocksToEditor(childrenOf(node))
  return content.length === 0 ? [{ type: 'paragraph' }] : content
}

function isTaskItem(node: ComarkNode): node is ElementNode {
  if (!isElement(node) || node[0] !== 'li' || node[1]['class'] !== TASK_ITEM) return false
  const [first] = childrenOf(node)
  return first !== undefined && isElement(first) && first[0] === 'input'
}

function listItem(node: ComarkNode, task: boolean): JSONContent {
  if (!isElement(node) || node[0] !== 'li') return raw(node, false)
  if (!task) {
    const content = containerContent(node)
    if (content[0]?.type !== 'paragraph') return raw(node, false)
    return { type: 'listItem', attrs: { props: propsOf(node) }, content }
  }
  const [box, ...rest] = childrenOf(node)
  const checked = isElement(box ?? '') && (box as ElementNode)[1][':checked'] === 'true'
  const [lead, ...after] = rest
  const children = typeof lead === 'string' ? [lead.replace(/^ /, ''), ...after] : rest
  const content = blocksToEditor(children)
  return {
    type: 'taskItem',
    attrs: { checked },
    content: content[0]?.type === 'paragraph' ? content : [{ type: 'paragraph' }, ...content],
  }
}

function cell(node: ComarkNode): JSONContent {
  if (!isElement(node)) return { type: 'tableCell', content: [{ type: 'paragraph' }] }
  const style = node[1]['style']
  const align =
    typeof style === 'string' ? (/text-align:(left|center|right)/.exec(style)?.[1] ?? null) : null
  return {
    type: node[0] === 'th' ? 'tableHeader' : 'tableCell',
    attrs: { align, props: propsOf(node, ['style']) },
    content: containerContent(node),
  }
}

function table(node: ElementNode): JSONContent {
  const rows: JSONContent[] = []
  for (const section of childrenOf(node)) {
    if (!isElement(section)) continue
    for (const row of childrenOf(section)) {
      if (isElement(row) && row[0] === 'tr') {
        rows.push({ type: 'tableRow', content: childrenOf(row).filter(isElement).map(cell) })
      }
    }
  }
  return { type: 'table', attrs: { props: propsOf(node) }, content: rows }
}

function blockToEditor(node: ComarkNode): JSONContent {
  if (typeof node === 'string' || !isElement(node) || isHtml(node)) return raw(node, false)
  const [tag] = node
  const heading = /^h([1-6])$/.exec(tag)
  if (heading !== null) {
    return {
      type: 'heading',
      attrs: { level: Number(heading[1]), props: propsOf(node) },
      content: inlineToEditor(childrenOf(node)),
    }
  }
  switch (tag) {
    case 'p':
      return paragraph(childrenOf(node), propsOf(node))
    case 'hr':
      return { type: 'horizontalRule' }
    case 'blockquote': {
      const as = node[1]['as']
      return typeof as === 'string'
        ? { type: 'callout', attrs: { kind: as }, content: containerContent(node) }
        : {
            type: 'blockquote',
            attrs: { props: propsOf(node) },
            content: containerContent(node),
          }
    }
    case 'ul': {
      const items = childrenOf(node)
      if (node[1]['class'] === TASK_LIST && items.every(isTaskItem)) {
        return { type: 'taskList', content: items.map((item) => listItem(item, true)) }
      }
      const content = items.map((item) => listItem(item, false))
      if (content.some((item) => item.type !== 'listItem')) return raw(node, false)
      return { type: 'bulletList', attrs: { props: propsOf(node) }, content }
    }
    case 'ol': {
      const content = childrenOf(node).map((item) => listItem(item, false))
      if (content.some((item) => item.type !== 'listItem')) return raw(node, false)
      const start = Number(node[1]['start'] ?? 1)
      return {
        type: 'orderedList',
        attrs: { start: Number.isFinite(start) ? start : 1, props: propsOf(node, ['start']) },
        content,
      }
    }
    case 'pre': {
      const highlights = node[1]['highlights']
      return {
        type: 'codeBlock',
        attrs: {
          language: typeof node[1]['language'] === 'string' ? node[1]['language'] : null,
          filename: typeof node[1]['filename'] === 'string' ? node[1]['filename'] : null,
          highlights: Array.isArray(highlights) ? highlights : null,
          props: propsOf(node, ['language', 'filename', 'highlights']),
        },
        ...(textOf(node) === '' ? {} : { content: [{ type: 'text', text: textOf(node) }] }),
      }
    }
    case 'table':
      return table(node)
    case 'template':
      return {
        type: 'comarkSlot',
        attrs: { name: textOr(node[1]['name'], 'default') },
        content: containerContent(node),
      }
    case 'li':
      return raw(node, false)
    default:
      if (BLOCK_TAGS.has(tag)) return raw(node, false)
      return {
        type: 'comarkComponent',
        attrs: { name: tag, props: propsOf(node) },
        content: blocksToEditor(childrenOf(node)),
      }
  }
}

export function toEditor(nodes: readonly ComarkNode[]): JSONContent {
  const content = blocksToEditor(nodes)
  return { type: 'doc', content: content.length === 0 ? [{ type: 'paragraph' }] : content }
}

function textOr(value: unknown, fallback: string): string {
  return typeof value === 'string' && value !== '' ? value : fallback
}

function attrsOf(node: JSONContent | Mark): Props {
  return node.attrs ?? {}
}

function withProps(base: Props, props: unknown): Props {
  return typeof props === 'object' && props !== null ? { ...base, ...props } : base
}

function element(tag: string, props: Props, children: readonly ComarkNode[]): ElementNode {
  return [tag, props, ...children]
}

function markElement(mark: Mark): ElementNode {
  const attrs = attrsOf(mark)
  if (mark.type === 'link') {
    const base: Props = { href: attrs['href'] ?? '' }
    if (attrs['title'] !== null && attrs['title'] !== undefined) base['title'] = attrs['title']
    return element('a', withProps(base, attrs['props']), [])
  }
  return element(TAGS[mark.type] ?? mark.type, withProps({}, attrs['props']), [])
}

function sameMark(a: Mark, b: Mark): boolean {
  return a.type === b.type && JSON.stringify(a.attrs ?? {}) === JSON.stringify(b.attrs ?? {})
}

function inlineNode(node: JSONContent): ComarkNode | null {
  const attrs = attrsOf(node)
  switch (node.type) {
    case 'text':
      return node.text ?? ''
    case 'hardBreak':
      return ['br', {}]
    case 'image': {
      const base: Props = { src: attrs['src'] ?? '' }
      if (attrs['title'] !== null && attrs['title'] !== undefined) base['title'] = attrs['title']
      base['alt'] = attrs['alt'] ?? ''
      return element('img', withProps(base, attrs['props']), [])
    }
    case 'comarkInline':
      return (attrs['node'] as ComarkNode | undefined) ?? null
    default:
      return null
  }
}

function inlineFromEditor(content: readonly JSONContent[] = []): ComarkNode[] {
  const root: ComarkNode[] = []
  const stack: { mark: Mark; element: ElementNode }[] = []
  const top = () => (stack.length === 0 ? root : stack[stack.length - 1]!.element)
  for (const node of content) {
    const marks = node.type === 'text' ? (node.marks ?? []) : (node.marks ?? [])
    let keep = 0
    while (keep < stack.length && marks.some((mark) => sameMark(mark, stack[keep]!.mark))) keep++
    stack.length = keep
    for (const mark of marks) {
      if (stack.some((open) => sameMark(open.mark, mark))) continue
      const opened = markElement(mark)
      top().push(opened)
      stack.push({ mark, element: opened })
    }
    const inline = inlineNode(node)
    if (inline === null) continue
    const parent = top()
    const last = parent[parent.length - 1]
    if (typeof inline === 'string' && typeof last === 'string' && parent !== root) {
      parent[parent.length - 1] = last + inline
    } else if (typeof inline === 'string' && typeof last === 'string' && parent === root) {
      root[root.length - 1] = last + inline
    } else {
      parent.push(inline)
    }
  }
  return root.map(codeText)
}

function codeText(node: ComarkNode): ComarkNode {
  if (!isElement(node)) return node
  const [tag, props, ...children] = node
  if (tag === 'code')
    return [
      tag,
      props,
      children
        .map((child) => (typeof child === 'string' ? child : textOf(child as ElementNode)))
        .join(''),
    ]
  return [tag, props, ...children.map(codeText)]
}

function unwrapSingle(blocks: readonly ComarkNode[]): ComarkNode[] {
  const [first, ...rest] = blocks
  const nestedLists = rest.every(
    (block) => isElement(block) && (block[0] === 'ul' || block[0] === 'ol'),
  )
  if (first !== undefined && isElement(first) && first[0] === 'p' && nestedLists) {
    return [...childrenOf(first), ...rest]
  }
  return [...blocks]
}

function cellFromEditor(node: JSONContent): ElementNode {
  const attrs = attrsOf(node)
  const base: Props = {}
  if (typeof attrs['align'] === 'string') base['style'] = `text-align:${attrs['align']}`
  return element(
    node.type === 'tableHeader' ? 'th' : 'td',
    withProps(base, attrs['props']),
    unwrapSingle(blocksFromEditor(node.content)),
  )
}

function tableFromEditor(node: JSONContent): ElementNode {
  const rows = node.content ?? []
  const isHeader = (row: JSONContent) =>
    (row.content ?? []).length > 0 &&
    (row.content ?? []).every((cell) => cell.type === 'tableHeader')
  const head = rows.filter(isHeader)
  const body = rows.filter((row) => !isHeader(row))
  const row = (tr: JSONContent): ElementNode =>
    element('tr', {}, (tr.content ?? []).map(cellFromEditor))
  const sections: ElementNode[] = []
  if (head.length > 0) sections.push(element('thead', {}, head.map(row)))
  if (body.length > 0) sections.push(element('tbody', {}, body.map(row)))
  return element('table', withProps({}, attrsOf(node)['props']), sections)
}

function blockFromEditor(node: JSONContent): ComarkNode | null {
  const attrs = attrsOf(node)
  switch (node.type) {
    case 'paragraph':
      return element('p', withProps({}, attrs['props']), inlineFromEditor(node.content))
    case 'heading':
      return element(
        `h${Number(attrs['level'] ?? 1)}`,
        withProps({}, attrs['props']),
        inlineFromEditor(node.content),
      )
    case 'horizontalRule':
      return ['hr', {}]
    case 'blockquote':
      return element(
        'blockquote',
        withProps({}, attrs['props']),
        unwrapSingle(blocksFromEditor(node.content)),
      )
    case 'callout':
      return element(
        'blockquote',
        { as: attrs['kind'] ?? 'note' },
        unwrapSingle(blocksFromEditor(node.content)),
      )
    case 'bulletList':
      return element('ul', withProps({}, attrs['props']), (node.content ?? []).map(itemFromEditor))
    case 'orderedList': {
      const start = Number(attrs['start'] ?? 1)
      return element(
        'ol',
        withProps(start === 1 ? {} : { start: String(start) }, attrs['props']),
        (node.content ?? []).map(itemFromEditor),
      )
    }
    case 'taskList':
      return element('ul', { class: TASK_LIST }, (node.content ?? []).map(taskFromEditor))
    case 'codeBlock': {
      const base: Props = {}
      if (typeof attrs['language'] === 'string' && attrs['language'] !== '')
        base['language'] = attrs['language']
      if (typeof attrs['filename'] === 'string' && attrs['filename'] !== '')
        base['filename'] = attrs['filename']
      if (Array.isArray(attrs['highlights'])) base['highlights'] = attrs['highlights']
      const text = (node.content ?? []).map((child) => child.text ?? '').join('')
      const code: Props =
        typeof base['language'] === 'string' ? { class: `language-${base['language']}` } : {}
      return element('pre', withProps(base, attrs['props']), [element('code', code, [text])])
    }
    case 'table':
      return tableFromEditor(node)
    case 'comarkComponent':
      return element(
        textOr(attrs['name'], 'component'),
        withProps({}, attrs['props']),
        unwrapSingle(blocksFromEditor(node.content)),
      )
    case 'comarkSlot':
      return element(
        'template',
        { name: attrs['name'] ?? 'default' },
        unwrapSingle(blocksFromEditor(node.content)),
      )
    case 'comarkBlock':
      return (attrs['node'] as ComarkNode | undefined) ?? null
    default:
      return null
  }
}

function itemFromEditor(node: JSONContent): ComarkNode {
  if (node.type === 'comarkBlock') return blockFromEditor(node) ?? ['li', {}]
  return element(
    'li',
    withProps({}, attrsOf(node)['props']),
    unwrapSingle(blocksFromEditor(node.content)),
  )
}

function taskFromEditor(node: JSONContent): ElementNode {
  const box: Props = { class: 'task-list-item-checkbox', type: 'checkbox', ':disabled': 'true' }
  if (attrsOf(node)['checked'] === true) box[':checked'] = 'true'
  const [first, ...rest] = unwrapSingle(blocksFromEditor(node.content))
  const lead = typeof first === 'string' ? [` ${first}`] : first === undefined ? [] : [' ', first]
  return element('li', { class: TASK_ITEM }, [['input', box], ...lead, ...rest])
}

function blocksFromEditor(content: readonly JSONContent[] = []): ComarkNode[] {
  return content.flatMap((node) => {
    const block = blockFromEditor(node)
    return block === null ? [] : [block]
  })
}

export function fromEditor(doc: JSONContent): ComarkNode[] {
  return blocksFromEditor(doc.content).filter(
    (block) => !(isElement(block) && block[0] === 'p' && block.length === 2),
  )
}

export async function editsLosslessly(
  nodes: readonly ComarkNode[],
  opened: JSONContent,
  stringify: (nodes: ComarkNode[]) => Promise<string>,
): Promise<boolean> {
  return (await stringify([...nodes])) === (await stringify(fromEditor(opened)))
}
