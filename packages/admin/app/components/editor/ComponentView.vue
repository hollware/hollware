<script setup lang="ts">
import { NodeViewContent, NodeViewWrapper, nodeViewProps } from '@tiptap/vue-3'
import { computed, inject, ref } from 'vue'
import { useMessages } from '../../i18n/index.ts'
import {
  COMPONENTS_KEY,
  propEntries,
  propsFrom,
  type PropEntry,
} from '../../lib/editor/components.ts'

const props = defineProps(nodeViewProps)
const m = useMessages()
const definitions = inject(COMPONENTS_KEY, ref([]))

const name = computed(() => String(props.node.attrs['name'] ?? ''))
const definition = computed(() => definitions.value.find((known) => known.name === name.value))
const entries = computed(() =>
  propEntries(props.node.attrs['props'], definition.value?.props ?? null),
)
const known = computed(() => definition.value !== undefined)
const editing = ref<PropEntry[]>([])

function open(isOpen: boolean) {
  if (isOpen) editing.value = entries.value.map((entry) => ({ ...entry }))
}

function apply() {
  props.updateAttributes({ props: propsFrom(editing.value) })
}
</script>

<template>
  <NodeViewWrapper
    as="section"
    class="hw-component my-3 rounded-lg border border-default bg-elevated/40"
    :aria-label="m.editor.componentNamed(name)"
  >
    <header
      contenteditable="false"
      class="flex items-center gap-2 border-b border-default px-3 py-1.5 text-xs text-muted"
    >
      <UIcon name="i-lucide-puzzle" class="size-3.5 text-secondary" />
      <span class="font-mono font-medium text-highlighted">{{ name }}</span>
      <UBadge
        v-if="!known"
        :label="m.editor.component.unknown"
        color="error"
        variant="subtle"
        size="sm"
      />
      <span
        v-for="entry in entries.filter((entry) => entry.value !== '')"
        :key="entry.key"
        class="truncate font-mono"
        >{{ entry.label }}="{{ entry.value }}"</span
      >
      <UPopover :content="{ align: 'end' }" @update:open="open">
        <UButton
          :label="m.editor.component.props"
          icon="i-lucide-sliders-horizontal"
          size="xs"
          variant="ghost"
          color="neutral"
          class="ms-auto"
        />
        <template #content>
          <form class="w-72 space-y-3 p-3" @submit.prevent="apply">
            <p v-if="editing.length === 0" class="text-sm text-muted">
              {{ m.editor.component.noProps }}
            </p>
            <UFormField
              v-for="entry in editing"
              :key="entry.key"
              :label="entry.label"
              :description="entry.description ?? undefined"
            >
              <UInput v-model="entry.value" class="w-full" size="sm" />
            </UFormField>
            <UButton v-if="editing.length > 0" type="submit" :label="m.editor.apply" size="sm" />
          </form>
        </template>
      </UPopover>
    </header>
    <NodeViewContent class="px-4 py-2" />
  </NodeViewWrapper>
</template>
