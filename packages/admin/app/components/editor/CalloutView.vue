<script setup lang="ts">
import { NodeViewContent, NodeViewWrapper, nodeViewProps } from '@tiptap/vue-3'
import { computed } from 'vue'
import { useMessages } from '../../i18n/index.ts'
import { CALLOUT_KINDS, type CalloutKind } from '../../lib/editor/blocks.ts'

const props = defineProps(nodeViewProps)
const m = useMessages()

const ICONS: Readonly<Record<CalloutKind, string>> = {
  note: 'i-lucide-info',
  tip: 'i-lucide-lightbulb',
  important: 'i-lucide-message-square-warning',
  warning: 'i-lucide-triangle-alert',
  caution: 'i-lucide-octagon-alert',
}

const kind = computed<CalloutKind>(() => {
  const value = String(props.node.attrs['kind'] ?? 'note').toLowerCase()
  return (CALLOUT_KINDS as readonly string[]).includes(value) ? (value as CalloutKind) : 'note'
})
const items = computed(() =>
  CALLOUT_KINDS.map((value) => ({
    label: m.value.editor.callouts[value],
    value,
    icon: ICONS[value],
  })),
)
</script>

<template>
  <NodeViewWrapper
    as="aside"
    class="hw-callout my-3 flex gap-3 rounded-lg border border-default bg-elevated/50 px-3 py-2"
    :data-kind="kind"
  >
    <div contenteditable="false" class="pt-0.5">
      <USelect
        :model-value="kind"
        :items="items"
        :icon="ICONS[kind]"
        :aria-label="m.editor.calloutKind"
        variant="ghost"
        size="xs"
        class="w-auto"
        @update:model-value="(value) => updateAttributes({ kind: value })"
      />
    </div>
    <NodeViewContent class="min-w-0 flex-1" />
  </NodeViewWrapper>
</template>
