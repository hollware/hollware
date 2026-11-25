import type { JSONContent } from '@tiptap/core'
import type { Node as ProseNode, ResolvedPos } from '@tiptap/pm/model'
import { Selection, type Transaction } from '@tiptap/pm/state'

const COMPONENT = 'comarkComponent'

function componentAt(tr: Transaction, pos: number): ProseNode | null {
  const node = tr.doc.nodeAt(pos)
  return node?.type.name === COMPONENT ? node : null
}

export function componentAround($pos: ResolvedPos): number | null {
  for (let depth = $pos.depth; depth > 0; depth--) {
    if ($pos.node(depth).type.name === COMPONENT) return $pos.before(depth)
  }
  return null
}

export function duplicateNode(tr: Transaction, pos: number): boolean {
  const node = tr.doc.nodeAt(pos)
  if (node === null) return false
  tr.insert(pos + node.nodeSize, node.copy(node.content))
  return true
}

export function deleteNode(tr: Transaction, pos: number): boolean {
  const node = tr.doc.nodeAt(pos)
  if (node === null) return false
  tr.delete(pos, pos + node.nodeSize)
  return true
}

export function moveNode(tr: Transaction, pos: number, by: -1 | 1): boolean {
  const node = tr.doc.nodeAt(pos)
  if (node === null) return false
  const $pos = tr.doc.resolve(pos)
  const index = $pos.index()
  const sibling = $pos.parent.maybeChild(index + by)
  if (sibling === null) return false
  const size = node.nodeSize
  const before = tr.selection
  const to = by === -1 ? pos - sibling.nodeSize : pos + sibling.nodeSize
  if (by === -1) tr.delete(pos, pos + size).insert(to, node)
  else tr.insert(pos + size + sibling.nodeSize, node).delete(pos, pos + size)
  if (before.from > pos && before.to < pos + size) {
    tr.setSelection(Selection.near(tr.doc.resolve(to + (before.from - pos))))
  }
  return true
}

export function repeatedChild(node: ProseNode): string | null {
  const names = new Set<string>()
  node.forEach((child) => {
    if (child.type.name === COMPONENT) names.add(String(child.attrs['name']))
  })
  return names.size === 1 ? [...names][0]! : null
}

function isEmptyParagraph(node: ProseNode): boolean {
  return node.type.name === 'paragraph' && node.content.size === 0
}

export function insertInside(tr: Transaction, pos: number, content: JSONContent): boolean {
  const parent = componentAt(tr, pos)
  if (parent === null) return false
  const child = tr.doc.type.schema.nodeFromJSON(content)
  const only = parent.childCount === 1 ? parent.child(0) : null
  if (only !== null && isEmptyParagraph(only)) {
    tr.replaceWith(pos + 1, pos + 1 + only.nodeSize, child)
  } else {
    tr.insert(pos + parent.nodeSize - 1, child)
  }
  return true
}

export function addChild(tr: Transaction, pos: number, content: JSONContent): boolean {
  const parent = componentAt(tr, pos)
  if (parent === null) return false
  const name = content.attrs?.['name']
  let after: number | null = null
  parent.forEach((child, offset) => {
    if (child.type.name === COMPONENT && child.attrs['name'] === name) {
      after = pos + 1 + offset + child.nodeSize
    }
  })
  if (after === null) return false
  tr.insert(after, tr.doc.type.schema.nodeFromJSON(content))
  return true
}
