<script setup lang="ts">
import { markdown } from '@codemirror/lang-markdown'
import { MergeView, unifiedMergeView } from '@codemirror/merge'
import { EditorState } from '@codemirror/state'
import { EditorView } from '@codemirror/view'
import { onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useMessages } from '../i18n/index.ts'
import { useNarrow } from '../lib/narrow.ts'
import { theme } from './editor-theme.ts'

const props = defineProps<{
  original: string
  modified: string
  originalLabel?: string
  modifiedLabel?: string
}>()

const host = ref<HTMLElement | null>(null)
const m = useMessages()
const narrow = useNarrow()
let view: MergeView | EditorView | null = null

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
  if (narrow.value) {
    view = new EditorView({
      doc: props.modified,
      extensions: [
        readOnly,
        unifiedMergeView({
          original: props.original,
          mergeControls: false,
          collapseUnchanged: { margin: 3, minSize: 6 },
        }),
        EditorState.phrases.of({ '$ unchanged lines': m.value.editor.unchangedLines }),
        EditorView.contentAttributes.of({
          'aria-label': props.modifiedLabel ?? m.value.editor.asked,
        }),
      ],
      parent: host.value,
    })
    return
  }
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
watch(() => [props.original, props.modified, narrow.value], mount)
</script>

<template>
  <div ref="host" class="overflow-hidden rounded border border-default text-sm" />
</template>
