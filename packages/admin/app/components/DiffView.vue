<script setup lang="ts">
import { markdown } from '@codemirror/lang-markdown'
import { MergeView } from '@codemirror/merge'
import { EditorState } from '@codemirror/state'
import { EditorView } from '@codemirror/view'
import { onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useMessages } from '../i18n/index.ts'
import { theme } from './editor-theme.ts'

/**
 * Two Markdown files side by side, read-only, with what changed marked: by default what is live
 * beside the revision asked for; the history names its own sides.
 */
const props = defineProps<{
  original: string
  modified: string
  originalLabel?: string
  modifiedLabel?: string
}>()

const host = ref<HTMLElement | null>(null)
const m = useMessages()
let view: MergeView | null = null

/**
 * The unchanged lines between two changes, collapsed: a flat band of the admin's colors, never the
 * merge view's own gradient, which is made for a light editor and glares on a dark one.
 */
const band = {
  display: 'flex',
  alignItems: 'center',
  gap: '8px',
  padding: '6px 12px',
  background: 'var(--ui-bg-elevated)',
  color: 'var(--ui-text-muted)',
  borderBlock: '1px solid var(--ui-border)',
  fontFamily: 'var(--font-sans)',
  fontSize: '12px',
  transition: 'background-color 120ms, color 120ms',
}
// `&.cm-editor` outweighs the light and dark rules of the merge view's base theme.
const collapsed = EditorView.theme({
  '&.cm-editor .cm-collapsedLines': band,
  '&.cm-editor .cm-collapsedLines:hover': {
    background: 'var(--ui-bg-accented)',
    color: 'var(--ui-text-highlighted)',
  },
  '&.cm-editor .cm-collapsedLines:before': {
    content: '"↕"',
    marginInlineEnd: '0',
    color: 'var(--ui-text-dimmed)',
  },
  '&.cm-editor .cm-collapsedLines:after': { content: 'none' },
})

const readOnly = [
  markdown(),
  theme,
  collapsed,
  EditorView.lineWrapping,
  EditorView.editable.of(false),
  EditorState.readOnly.of(true),
]

function mount() {
  view?.destroy()
  if (host.value === null) return
  view = new MergeView({
    a: {
      doc: props.original,
      extensions: [
        readOnly,
        EditorState.phrases.of({ '$ unchanged lines': m.value.editor.unchangedLines }),
        EditorView.contentAttributes.of({
          'aria-label': props.originalLabel ?? m.value.editor.live,
        }),
      ],
    },
    b: {
      doc: props.modified,
      extensions: [
        readOnly,
        EditorState.phrases.of({ '$ unchanged lines': m.value.editor.unchangedLines }),
        EditorView.contentAttributes.of({
          'aria-label': props.modifiedLabel ?? m.value.editor.asked,
        }),
      ],
    },
    parent: host.value,
    collapseUnchanged: { margin: 3, minSize: 6 },
  })
}

onMounted(mount)
onBeforeUnmount(() => view?.destroy())
watch(() => [props.original, props.modified], mount)
</script>

<template>
  <div ref="host" class="overflow-hidden rounded border border-default text-sm" />
</template>
