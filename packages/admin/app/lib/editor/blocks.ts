import type { Editor, JSONContent } from '@tiptap/core'

export const CALLOUT_KINDS = ['note', 'tip', 'important', 'warning', 'caution'] as const
export type CalloutKind = (typeof CALLOUT_KINDS)[number]

export interface BlockLabels {
  readonly text: string
  readonly heading1: string
  readonly heading2: string
  readonly heading3: string
  readonly bullets: string
  readonly numbered: string
  readonly todo: string
  readonly quote: string
  readonly callout: string
  readonly code: string
  readonly image: string
  readonly table: string
  readonly divider: string
}

export interface SlashLabels {
  readonly blocks: BlockLabels
  readonly basics: string
  readonly media: string
  readonly components: string
  readonly componentHelp: (description: string | null) => string
}

export interface SlashComponent {
  readonly name: string
  readonly description: string | null
  readonly content: JSONContent
}

type SlashItem =
  | { readonly type: 'label'; readonly label: string }
  | {
      readonly kind: string
      readonly label: string
      readonly icon: string
      readonly level?: 1 | 2 | 3
      readonly description?: string
      readonly content?: JSONContent
    }

export function slashItems(
  labels: SlashLabels,
  components: readonly SlashComponent[],
): SlashItem[][] {
  const { blocks } = labels
  const groups: SlashItem[][] = [
    [
      { type: 'label', label: labels.basics },
      { kind: 'paragraph', label: blocks.text, icon: 'i-lucide-type' },
      { kind: 'heading', level: 1, label: blocks.heading1, icon: 'i-lucide-heading-1' },
      { kind: 'heading', level: 2, label: blocks.heading2, icon: 'i-lucide-heading-2' },
      { kind: 'heading', level: 3, label: blocks.heading3, icon: 'i-lucide-heading-3' },
      { kind: 'bulletList', label: blocks.bullets, icon: 'i-lucide-list' },
      { kind: 'orderedList', label: blocks.numbered, icon: 'i-lucide-list-ordered' },
      { kind: 'taskList', label: blocks.todo, icon: 'i-lucide-list-checks' },
      { kind: 'blockquote', label: blocks.quote, icon: 'i-lucide-text-quote' },
      { kind: 'callout', label: blocks.callout, icon: 'i-lucide-info' },
      { kind: 'codeBlock', label: blocks.code, icon: 'i-lucide-square-code' },
      { kind: 'horizontalRule', label: blocks.divider, icon: 'i-lucide-minus' },
    ],
    [
      { type: 'label', label: labels.media },
      { kind: 'pickImage', label: blocks.image, icon: 'i-lucide-image' },
      { kind: 'table', label: blocks.table, icon: 'i-lucide-table' },
    ],
  ]
  if (components.length > 0) {
    groups.push([
      { type: 'label', label: labels.components },
      ...components.map((component) => ({
        kind: 'component',
        label: component.name,
        description: labels.componentHelp(component.description),
        icon: 'i-lucide-puzzle',
        content: component.content,
      })),
    ])
  }
  return groups
}

export interface CustomHandler {
  canExecute: (editor: Editor, cmd?: unknown) => boolean
  execute: (editor: Editor, cmd?: unknown) => ReturnType<Editor['chain']>
  isActive: (editor: Editor, cmd?: unknown) => boolean
}

function contentOf(cmd: unknown): JSONContent | null {
  if (typeof cmd !== 'object' || cmd === null) return null
  const content: unknown = Reflect.get(cmd, 'content')
  return typeof content === 'object' && content !== null ? (content as JSONContent) : null
}

export function customHandlers(pickImage: () => void): Record<string, CustomHandler> {
  return {
    callout: {
      canExecute: () => true,
      execute: (editor) =>
        editor
          .chain()
          .focus()
          .insertContent({
            type: 'callout',
            attrs: { kind: 'note' },
            content: [{ type: 'paragraph' }],
          }),
      isActive: (editor) => editor.isActive('callout'),
    },
    table: {
      canExecute: () => true,
      execute: (editor) =>
        editor.chain().focus().insertTable({ rows: 3, cols: 2, withHeaderRow: true }),
      isActive: (editor) => editor.isActive('table'),
    },
    component: {
      canExecute: () => true,
      execute: (editor, cmd) => {
        const content = contentOf(cmd)
        return content === null ? editor.chain() : editor.chain().focus().insertContent(content)
      },
      isActive: (editor) => editor.isActive('comarkComponent'),
    },
    pickImage: {
      canExecute: () => true,
      execute: (editor) => {
        pickImage()
        return editor.chain()
      },
      isActive: (editor) => editor.isActive('image'),
    },
  }
}
