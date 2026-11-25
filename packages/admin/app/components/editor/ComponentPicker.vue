<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useMessages } from '../../i18n/index.ts'
import { matchingComponents, type ComponentDefinition } from '../../lib/editor/components.ts'

const props = defineProps<{
  readonly definitions: readonly ComponentDefinition[]
  readonly title: string
}>()
const emit = defineEmits<{ pick: [name: string] }>()
const open = defineModel<boolean>('open', { required: true })
const m = useMessages()

const query = ref('')
const found = computed(() => matchingComponents(props.definitions, query.value))

watch(open, (isOpen) => {
  if (isOpen) query.value = ''
})

function pick(name: string) {
  open.value = false
  emit('pick', name)
}

function pickFirst() {
  const first = found.value[0]
  if (first !== undefined) pick(first.name)
}
</script>

<template>
  <UModal
    v-model:open="open"
    :title="title"
    :description="m.editor.component.pickerHint"
    :ui="{ content: 'max-w-4xl', body: 'space-y-4' }"
  >
    <template #body>
      <UInput
        v-model="query"
        icon="i-lucide-search"
        autofocus
        class="w-full"
        size="lg"
        :placeholder="m.editor.component.search"
        :aria-label="m.editor.component.search"
        @keydown.enter.prevent="pickFirst"
      />
      <p v-if="found.length === 0" class="py-8 text-center text-sm text-muted">
        {{ m.editor.component.noMatch }}
      </p>
      <ul
        v-else
        class="grid max-h-[60vh] grid-cols-1 gap-3 overflow-y-auto p-1 sm:grid-cols-2 lg:grid-cols-3"
      >
        <li v-for="component in found" :key="component.name">
          <button
            type="button"
            class="flex h-full w-full flex-col gap-1.5 rounded-lg border border-default p-4 text-left transition hover:border-secondary/60 hover:bg-elevated/60 focus-visible:ring-2 focus-visible:ring-secondary focus-visible:outline-none"
            @click="pick(component.name)"
          >
            <span class="flex items-center gap-2">
              <UIcon name="i-lucide-puzzle" class="size-4 shrink-0 text-secondary" />
              <span class="font-mono text-sm font-medium text-highlighted">{{
                component.name
              }}</span>
            </span>
            <span v-if="component.description" class="text-sm text-toned">
              {{ component.description }}
            </span>
          </button>
        </li>
      </ul>
    </template>
  </UModal>
</template>
