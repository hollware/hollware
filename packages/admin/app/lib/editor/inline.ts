import type { JSONContent } from '@tiptap/core'
import type { Transaction } from '@tiptap/pm/state'
import type { ElementNode, Node as ComarkNode } from 'comark'
import { inlineFromEditor } from './convert.ts'

type Props = Record<string, unknown>

function isRecord(value: unknown): value is Props {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function meta(node: ElementNode): Props | null {
  const value: unknown = node[1]['$']
  return isRecord(value) ? value : null
}

export function isInlineComponent(node: unknown): node is ElementNode {
  if (!Array.isArray(node) || typeof node[0] !== 'string' || !isRecord(node[1])) return false
  return meta(node as ElementNode)?.['html'] !== 1
}

export function inlineText(node: ComarkNode): string {
  if (typeof node === 'string') return node
  if (!Array.isArray(node)) return ''
  return node
    .slice(2)
    .map((child) => inlineText(child as ComarkNode))
    .join('')
}

export function inlineProps(node: ElementNode): Props | null {
  const props: Props = {}
  for (const [key, value] of Object.entries(node[1])) if (key !== '$') props[key] = value
  return Object.keys(props).length === 0 ? null : props
}

export function editedInline(
  node: ElementNode,
  text: string,
  props: Readonly<Props> | null,
): ElementNode {
  const [tag] = node
  const kept = meta(node)
  const attributes: Props = { ...(kept === null ? {} : { $: kept }), ...props }
  const children = text === inlineText(node) ? (node.slice(2) as ComarkNode[]) : [text]
  return [tag, attributes, ...children.filter((child) => child !== '')]
}

export function wrapInline(tr: Transaction, from: number, to: number, name: string): boolean {
  const $from = tr.doc.resolve(from)
  const $to = tr.doc.resolve(to)
  const type = tr.doc.type.schema.nodes['comarkInline']
  if (type === undefined || from === to || !$from.sameParent($to)) return false
  if (!$from.parent.canReplaceWith($from.index(), $to.indexAfter(), type)) return false
  const selected = tr.doc.slice(from, to).content.toJSON() as JSONContent[] | null
  tr.replaceWith(from, to, type.create({ node: [name, {}, ...inlineFromEditor(selected ?? [])] }))
  return true
}
