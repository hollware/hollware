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

const readOnly = [
  markdown(),
  theme,
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
        EditorView.contentAttributes.of({
          'aria-label': props.originalLabel ?? m.value.editor.live,
        }),
      ],
    },
    b: {
      doc: props.modified,
      extensions: [
        readOnly,
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
