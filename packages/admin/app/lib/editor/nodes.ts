import { type AnyExtension, Extension, mergeAttributes, Node } from '@tiptap/core'
import Image from '@tiptap/extension-image'
import { TaskItem, TaskList } from '@tiptap/extension-list'
import { Table, TableCell, TableHeader, TableRow } from '@tiptap/extension-table'
import StarterKit, { type StarterKitOptions } from '@tiptap/starter-kit'
import type { Node as ComarkNode } from 'comark'

function comarkText(node: ComarkNode): string {
  if (typeof node === 'string') return node
  if (!Array.isArray(node) || node[0] === null) return ''
  return node
    .slice(2)
    .map((child) => comarkText(child as ComarkNode))
    .join('')
}

function nameOf(node: unknown): string {
  return Array.isArray(node) && typeof node[0] === 'string' ? node[0] : '!--'
}

export const ComarkProps = Extension.create({
  name: 'comarkProps',
  addGlobalAttributes() {
    return [
      {
        types: [
          'paragraph',
          'heading',
          'blockquote',
          'bulletList',
          'orderedList',
          'listItem',
          'codeBlock',
          'image',
          'table',
          'tableCell',
          'tableHeader',
          'bold',
          'italic',
          'strike',
          'code',
          'link',
        ],
        attributes: {
          props: { default: null, rendered: false },
        },
      },
      {
        types: ['codeBlock'],
        attributes: {
          filename: { default: null, rendered: false },
          highlights: { default: null, rendered: false },
        },
      },
      {
        types: ['tableCell', 'tableHeader'],
        attributes: {
          align: {
            default: null,
            renderHTML: (attributes: Record<string, unknown>) =>
              typeof attributes['align'] === 'string'
                ? { style: `text-align:${attributes['align']}` }
                : {},
          },
        },
      },
    ]
  },
})

export const Callout = Node.create({
  name: 'callout',
  group: 'block',
  content: 'block+',
  defining: true,
  addAttributes() {
    return { kind: { default: 'note', rendered: false } }
  },
  parseHTML() {
    return [{ tag: 'div[data-callout]' }]
  },
  renderHTML({ node, HTMLAttributes }) {
    return [
      'div',
      mergeAttributes(HTMLAttributes, { 'data-callout': node.attrs['kind'], class: 'hw-callout' }),
      0,
    ]
  },
})

export const ComarkComponent = Node.create({
  name: 'comarkComponent',
  group: 'block',
  content: 'block*',
  defining: true,
  isolating: true,
  addAttributes() {
    return {
      name: { default: 'component', rendered: false },
      props: { default: null, rendered: false },
    }
  },
  parseHTML() {
    return [{ tag: 'div[data-component]' }]
  },
  renderHTML({ node, HTMLAttributes }) {
    return [
      'div',
      mergeAttributes(HTMLAttributes, {
        'data-component': node.attrs['name'],
        class: 'hw-component',
      }),
      0,
    ]
  },
})

export const ComarkSlot = Node.create({
  name: 'comarkSlot',
  group: 'block',
  content: 'block*',
  defining: true,
  addAttributes() {
    return { name: { default: 'default', rendered: false } }
  },
  parseHTML() {
    return [{ tag: 'div[data-slot]' }]
  },
  renderHTML({ node, HTMLAttributes }) {
    return [
      'div',
      mergeAttributes(HTMLAttributes, { 'data-slot': node.attrs['name'], class: 'hw-slot' }),
      0,
    ]
  },
})

export const ComarkBlock = Node.create({
  name: 'comarkBlock',
  group: 'block',
  atom: true,
  selectable: true,
  draggable: true,
  addAttributes() {
    return { node: { default: null, rendered: false } }
  },
  parseHTML() {
    return [{ tag: 'div[data-comark-block]' }]
  },
  renderHTML({ node, HTMLAttributes }) {
    return [
      'div',
      mergeAttributes(HTMLAttributes, {
        'data-comark-block': nameOf(node.attrs['node']),
        class: 'hw-raw',
      }),
      comarkText(node.attrs['node'] as ComarkNode),
    ]
  },
})

export const ComarkInline = Node.create({
  name: 'comarkInline',
  group: 'inline',
  inline: true,
  atom: true,
  selectable: true,
  addAttributes() {
    return { node: { default: null, rendered: false } }
  },
  parseHTML() {
    return [{ tag: 'span[data-comark-inline]' }]
  },
  renderHTML({ node, HTMLAttributes }) {
    return [
      'span',
      mergeAttributes(HTMLAttributes, {
        'data-comark-inline': nameOf(node.attrs['node']),
        class: 'hw-raw-inline',
      }),
      comarkText(node.attrs['node'] as ComarkNode),
    ]
  },
})

export const STARTER_KIT: Partial<StarterKitOptions> = {
  link: { openOnClick: false, autolink: false },
  underline: false,
  dropcursor: { color: 'var(--ui-secondary)', width: 2 },
}

export const IMAGE = { inline: true, allowBase64: false }

export const COMARK_EXTENSIONS: readonly AnyExtension[] = [
  ComarkProps,
  Callout,
  ComarkComponent,
  ComarkSlot,
  ComarkBlock,
  ComarkInline,
  TaskList,
  TaskItem.configure({ nested: true }),
  Table.configure({ resizable: false }),
  TableRow,
  TableHeader,
  TableCell,
]

export function editorExtensions(): AnyExtension[] {
  return [StarterKit.configure(STARTER_KIT), Image.configure(IMAGE), ...COMARK_EXTENSIONS]
}

export function imageWithAssets(resolve: (src: string) => string): AnyExtension {
  return Image.extend({
    renderHTML({ HTMLAttributes }) {
      const src = typeof HTMLAttributes['src'] === 'string' ? HTMLAttributes['src'] : ''
      return ['img', mergeAttributes(HTMLAttributes, { src: resolve(src), 'data-src': src })]
    },
  }).configure(IMAGE)
}
