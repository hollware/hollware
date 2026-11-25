<script setup lang="ts">
import { useQuery } from '@pinia/colada'
import { computed, ref } from 'vue'
import { useMessages } from '../i18n/index.ts'
import { titleOf } from '../lib/entries.ts'
import {
  addItem,
  fieldsOf,
  markdownOnly,
  moveItem,
  readFrontmatter,
  removeItem,
  setField,
  type Path,
  type Reference,
} from '../lib/frontmatter.ts'
import { api } from '../lib/session.ts'
import FrontmatterFields from './FrontmatterFields.vue'
import ImagePicker from './editor/ImagePicker.vue'

const props = defineProps<{
  modelValue: string
  schema: Readonly<Record<string, unknown>>
  omit?: readonly string[]
  references?: Readonly<Record<string, Reference>>
}>()
const emit = defineEmits<{ 'update:modelValue': [value: string]; markdown: [] }>()

const m = useMessages()
const fields = computed(() =>
  fieldsOf(props.schema).filter((field) => !(props.omit ?? []).includes(field.key)),
)
const hidden = computed(() => markdownOnly(props.schema))
const values = computed(() => readFrontmatter(props.modelValue))
const picking = ref<Path | null>(null)
const pickerOpen = computed({
  get: () => picking.value !== null,
  set: (open: boolean) => {
    if (!open) picking.value = null
  },
})
const choicesQuery = useQuery(() => {
  const entries = Object.entries(props.references ?? {})
  return {
    key: [
      'choices',
      entries.map(([key, reference]) => [key, reference.collection, reference.locale]),
    ],
    query: async ({ signal }: { signal: AbortSignal }) => {
      const lists = await Promise.all(
        entries.map(([, reference]) =>
          api.call(
            'list_entries',
            { collection: reference.collection, locale: reference.locale, limit: 100 },
            signal,
          ),
        ),
      )
      return Object.fromEntries(
        entries.map(([key], index) => [
          key,
          (lists[index]?.entries ?? []).map((entry) => ({
            label: titleOf(entry),
            value: entry.slug,
          })),
        ]),
      )
    },
    enabled: entries.length > 0,
  }
})
const choices = computed(() => choicesQuery.data.value ?? {})

function pick(image: { src: string }) {
  if (picking.value !== null) set(picking.value, image.src)
  picking.value = null
}

function write(next: (markdown: string) => string) {
  if (values.value === null) return
  emit('update:modelValue', next(props.modelValue))
}
function set(path: Path, value: unknown) {
  write((markdown) => setField(markdown, path, value))
}
</script>

<template>
  <p v-if="values === null" class="text-sm text-muted">
    {{ m.frontmatter.notYamlBefore }}<code>---</code>{{ m.frontmatter.notYamlAfter }}
  </p>
  <p v-else-if="fields.length === 0 && hidden.length === 0" class="text-sm text-muted">
    {{ m.frontmatter.noFields }}
  </p>
  <form v-else class="space-y-4" @submit.prevent>
    <UAlert
      v-if="hidden.length > 0"
      :description="m.frontmatter.markdownOnly(hidden.join(', '))"
      icon="i-lucide-file-code-2"
      color="neutral"
      variant="subtle"
      :actions="[
        { label: m.frontmatter.openMarkdown, variant: 'outline', onClick: () => emit('markdown') },
      ]"
    />
    <FrontmatterFields
      :fields="fields"
      :values="values"
      :path="[]"
      :references="references ?? {}"
      :choices="choices"
      @set="set"
      @add="(path, item) => write((markdown) => addItem(markdown, path, item))"
      @remove="(path, index) => write((markdown) => removeItem(markdown, path, index))"
      @move="(path, from, to) => write((markdown) => moveItem(markdown, path, from, to))"
      @pick="(path) => (picking = path)"
    />
  </form>
  <ImagePicker v-model:open="pickerOpen" @pick="pick" />
</template>
