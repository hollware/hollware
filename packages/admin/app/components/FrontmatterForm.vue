<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useMessages } from '../i18n/index.ts'
import { titleOf } from '../lib/entries.ts'
import {
  fieldsOf,
  markdownOnly,
  readFrontmatter,
  setField,
  type Field,
  type Reference,
} from '../lib/frontmatter.ts'
import { api } from '../lib/session.ts'
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
const picking = ref<string | null>(null)
const pickerOpen = computed({
  get: () => picking.value !== null,
  set: (open: boolean) => {
    if (!open) picking.value = null
  },
})
const choices = ref<Record<string, { label: string; value: string }[]>>({})

watch(
  () => props.references,
  async (references) => {
    const entries = Object.entries(references ?? {})
    const lists = await Promise.all(
      entries.map(([, reference]) =>
        api.call('list_entries', {
          collection: reference.collection,
          locale: reference.locale,
          limit: 100,
        }),
      ),
    )
    choices.value = Object.fromEntries(
      entries.map(([key], index) => [
        key,
        (lists[index]?.entries ?? []).map((entry) => ({
          label: titleOf(entry),
          value: entry.slug,
        })),
      ]),
    )
  },
  { immediate: true },
)

function pick(image: { src: string }) {
  if (picking.value !== null) set(picking.value, image.src)
  picking.value = null
}

function set(key: string, value: unknown) {
  if (values.value === null) return
  emit('update:modelValue', setField(props.modelValue, key, value))
}

function text(field: Field): string {
  const value = values.value?.[field.key]
  return value === undefined || value === null ? '' : String(value)
}
function list(field: Field): string[] {
  const value = values.value?.[field.key]
  return Array.isArray(value) ? value.map(String) : []
}
function number(field: Field): number | undefined {
  const value = values.value?.[field.key]
  return typeof value === 'number' ? value : undefined
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
    <UFormField
      v-for="field in fields"
      :key="field.key"
      :label="field.key"
      :required="field.required"
      :help="field.description ?? undefined"
      :hint="
        field.maxLength !== null && (field.kind === 'text' || field.kind === 'long')
          ? `${text(field).length} / ${field.maxLength}`
          : undefined
      "
    >
      <USelectMenu
        v-if="
          references?.[field.key] !== undefined && (field.kind === 'text' || field.kind === 'list')
        "
        :model-value="field.kind === 'list' ? list(field) : text(field)"
        :items="choices[field.key] ?? []"
        value-key="value"
        :multiple="field.kind === 'list'"
        :placeholder="m.frontmatter.pickEntry"
        class="w-full"
        @update:model-value="set(field.key, $event)"
      />
      <div v-else-if="field.kind === 'image'" class="flex items-center gap-2">
        <UInput
          :model-value="text(field)"
          class="min-w-0 flex-1 font-mono"
          @update:model-value="set(field.key, $event === '' ? undefined : $event)"
        />
        <UButton
          :label="m.frontmatter.chooseImage"
          icon="i-lucide-image"
          color="neutral"
          variant="outline"
          @click="picking = field.key"
        />
      </div>
      <UTextarea
        v-else-if="field.kind === 'long'"
        :model-value="text(field)"
        :rows="3"
        autoresize
        class="w-full"
        @update:model-value="set(field.key, $event)"
      />
      <UInput
        v-else-if="field.kind === 'date'"
        type="date"
        :model-value="text(field)"
        class="w-full"
        @update:model-value="set(field.key, $event)"
      />
      <USelect
        v-else-if="field.kind === 'choice'"
        :model-value="text(field)"
        :items="field.options"
        class="w-full"
        @update:model-value="set(field.key, $event)"
      />
      <UInputTags
        v-else-if="field.kind === 'list'"
        :model-value="list(field)"
        class="w-full"
        @update:model-value="set(field.key, $event)"
      />
      <UInputNumber
        v-else-if="field.kind === 'number'"
        :model-value="number(field)"
        class="w-full"
        @update:model-value="set(field.key, $event)"
      />
      <USwitch
        v-else-if="field.kind === 'switch'"
        :model-value="values[field.key] === true"
        @update:model-value="set(field.key, $event)"
      />
      <UInput
        v-else
        :model-value="text(field)"
        class="w-full"
        @update:model-value="set(field.key, $event)"
      />
    </UFormField>
  </form>
  <ImagePicker v-model:open="pickerOpen" @pick="pick" />
</template>
