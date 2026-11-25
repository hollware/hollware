<script setup lang="ts">
import { NodeViewWrapper, nodeViewProps } from '@tiptap/vue-3'
import type { Node as ComarkNode } from 'comark'
import { computed, inject, ref } from 'vue'
import { useMessages } from '../../i18n/index.ts'
import {
  COMPONENTS_KEY,
  propForm,
  propProblems,
  writeProps,
  type PropProblem,
  type PropValue,
} from '../../lib/editor/components.ts'
import {
  editedInline,
  inlineProps,
  inlineText,
  isInlineComponent,
} from '../../lib/editor/inline.ts'
import ImagePicker from './ImagePicker.vue'
import PropForm from './PropForm.vue'

const props = defineProps(nodeViewProps)
const m = useMessages()
const definitions = inject(COMPONENTS_KEY, ref([]))

const node = computed(() => props.node.attrs['node'] as ComarkNode | null)
const component = computed(() => (isInlineComponent(node.value) ? node.value : null))
const text = computed(() => (node.value === null ? '' : inlineText(node.value)))
const name = computed(() => component.value?.[0] ?? '')
const definition = computed(() => definitions.value.find((known) => known.name === name.value))
const given = computed(() => (component.value === null ? null : inlineProps(component.value)))
const form = computed(() => propForm(given.value, definition.value?.props ?? null))

const open = ref(false)
const picking = ref<string | null>(null)
const editingText = ref('')
const values = ref<Record<string, PropValue>>({})
const problems = ref<Record<string, PropProblem>>({})

function toggle(isOpen: boolean) {
  if (isOpen && picking.value === null) {
    editingText.value = text.value
    values.value = { ...form.value.values }
    problems.value = {}
  }
  open.value = isOpen
}

function apply() {
  const current = component.value
  if (current === null) return
  problems.value = propProblems(form.value.fields, values.value)
  if (Object.keys(problems.value).length > 0) return
  props.updateAttributes({
    node: editedInline(
      current,
      editingText.value,
      writeProps(given.value, form.value, values.value),
    ),
  })
  open.value = false
}

const pickerOpen = computed({
  get: () => picking.value !== null,
  set: (isOpen: boolean) => {
    if (!isOpen) picking.value = null
  },
})

function pick(image: { src: string }) {
  if (picking.value !== null) values.value = { ...values.value, [picking.value]: image.src }
  picking.value = null
}
</script>

<template>
  <NodeViewWrapper as="span" contenteditable="false" class="hw-inline-component">
    <UPopover
      v-if="component !== null"
      :open="open"
      :dismissible="picking === null"
      @update:open="toggle"
    >
      <button
        type="button"
        class="mx-0.5 inline-flex max-w-full items-baseline gap-1 rounded-md border border-secondary/40 bg-secondary/10 px-1.5 align-baseline text-[0.95em] focus-visible:ring-2 focus-visible:ring-secondary focus-visible:outline-none"
        :class="{ 'ring-2 ring-secondary/60': selected }"
        :aria-label="m.editor.inline.edit(name)"
        :disabled="!editor.isEditable"
      >
        <span class="font-mono text-xs text-secondary">{{ name }}</span>
        <span v-if="text !== ''" class="truncate text-highlighted">{{ text }}</span>
      </button>
      <template #content>
        <form class="max-h-[70vh] w-80 space-y-3 overflow-y-auto p-3" @submit.prevent="apply">
          <p class="flex items-center gap-2 text-xs text-muted">
            <UIcon name="i-lucide-puzzle" class="size-3.5 text-secondary" />
            <span class="font-mono font-medium text-highlighted">{{ name }}</span>
            <UBadge
              v-if="definition === undefined"
              :label="m.editor.component.unknown"
              color="error"
              variant="subtle"
              size="sm"
            />
          </p>
          <p v-if="definition?.description" class="text-sm text-toned">
            {{ definition.description }}
          </p>
          <UFormField :label="m.editor.inline.text" name="text">
            <UInput v-model="editingText" autofocus class="w-full" size="sm" />
          </UFormField>
          <PropForm
            v-model:values="values"
            :fields="form.fields"
            :problems="problems"
            @pick-image="(field: string) => (picking = field)"
          />
          <UButton type="submit" :label="m.editor.apply" size="sm" />
        </form>
      </template>
    </UPopover>
    <span
      v-else
      class="hw-raw-inline"
      :class="{ 'ring-2 ring-secondary/60': selected }"
      :title="m.editor.inline.raw"
      >{{ text }}</span
    >
    <ImagePicker v-model:open="pickerOpen" @pick="pick" />
  </NodeViewWrapper>
</template>
