<script setup lang="ts">
import { stringifyBody } from '@hollware/core'
import { NodeViewWrapper, nodeViewProps } from '@tiptap/vue-3'
import type { Node as ComarkNode } from 'comark'
import { ref, watchEffect } from 'vue'
import { useMessages } from '../../i18n/index.ts'

const props = defineProps(nodeViewProps)
const m = useMessages()
const source = ref('')

watchEffect(async () => {
  const node = props.node.attrs['node'] as ComarkNode | null
  source.value =
    node === null ? '' : (await stringifyBody({ nodes: [node], frontmatter: {}, meta: {} })).trim()
})
</script>

<template>
  <NodeViewWrapper
    contenteditable="false"
    class="my-3 rounded-lg border border-dashed border-default bg-elevated/30"
    :class="{ 'ring-2 ring-secondary/60': selected }"
  >
    <p class="flex items-center gap-2 px-3 pt-2 text-xs text-muted">
      <UIcon name="i-lucide-file-code-2" class="size-3.5" />
      {{ m.editor.raw }}
    </p>
    <pre
      class="overflow-x-auto px-3 pb-2 font-mono text-xs whitespace-pre-wrap text-toned"
    ><code>{{ source }}</code></pre>
  </NodeViewWrapper>
</template>
