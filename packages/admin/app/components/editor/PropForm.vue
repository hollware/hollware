<script setup lang="ts">
import { computed } from 'vue'
import { useMessages } from '../../i18n/index.ts'
import type { PropField, PropProblem, PropValue } from '../../lib/editor/components.ts'

const props = defineProps<{
  fields: readonly PropField[]
  problems: Readonly<Record<string, PropProblem>>
}>()
const values = defineModel<Record<string, PropValue>>('values', { required: true })
const emit = defineEmits<{ pickImage: [name: string] }>()
const m = useMessages()

function set(name: string, value: PropValue | undefined) {
  values.value = { ...values.value, [name]: value ?? null }
}

function text(name: string): string {
  const value = values.value[name]
  return value === null || value === undefined ? '' : String(value)
}

function number(name: string): number | null {
  const value = values.value[name]
  return typeof value === 'number' ? value : null
}

function problem(field: PropField): string | undefined {
  switch (props.problems[field.name]) {
    case 'required':
      return m.value.editor.component.problems.required
    case 'pattern':
      return m.value.editor.component.problems.pattern(field.pattern ?? '')
    case 'tooLong':
      return m.value.editor.component.problems.tooLong(field.maxLength ?? 0)
    default:
      return undefined
  }
}

function help(field: PropField): string | undefined {
  if (field.kind === 'other') return m.value.editor.component.other
  if (field.kind === 'switch' && field.placeholder !== null) {
    return [field.description, m.value.editor.component.defaultIs(field.placeholder)]
      .filter((part) => part !== null)
      .join(' ')
  }
  return field.description ?? undefined
}

const placeholders = computed(() =>
  Object.fromEntries(props.fields.map((field) => [field.name, field.placeholder ?? undefined])),
)
</script>

<template>
  <UFormField
    v-for="field in fields"
    :key="field.name"
    :name="field.name"
    :label="field.name"
    :required="field.required"
    :help="help(field)"
    :error="problem(field)"
  >
    <USelectMenu
      v-if="field.kind === 'choice'"
      :model-value="text(field.name) === '' ? undefined : text(field.name)"
      :items="[...field.options]"
      :placeholder="placeholders[field.name]"
      :search-input="false"
      :clear="!field.required"
      class="w-full"
      size="sm"
      @update:model-value="(value: string | null) => set(field.name, value)"
    />
    <USwitch
      v-else-if="field.kind === 'switch'"
      :model-value="values[field.name] === true"
      @update:model-value="(value: boolean) => set(field.name, value)"
    />
    <UInputNumber
      v-else-if="field.kind === 'number'"
      :model-value="number(field.name)"
      :placeholder="placeholders[field.name]"
      class="w-full"
      size="sm"
      @update:model-value="(value: number | null) => set(field.name, value)"
    />
    <div v-else-if="field.kind === 'image'" class="flex items-center gap-2">
      <UInput
        :model-value="text(field.name)"
        :placeholder="placeholders[field.name]"
        class="min-w-0 flex-1 font-mono"
        size="sm"
        @update:model-value="(value: string) => set(field.name, value)"
      />
      <UButton
        :aria-label="m.editor.component.chooseImage"
        icon="i-lucide-image"
        color="neutral"
        variant="outline"
        size="sm"
        @click="emit('pickImage', field.name)"
      />
    </div>
    <UTextarea
      v-else-if="field.kind === 'long'"
      :model-value="text(field.name)"
      :placeholder="placeholders[field.name]"
      :rows="3"
      autoresize
      class="w-full"
      size="sm"
      @update:model-value="(value: string) => set(field.name, value)"
    />
    <UInput
      v-else
      :model-value="text(field.name)"
      :type="field.kind === 'date' ? 'date' : 'text'"
      :placeholder="placeholders[field.name]"
      :class="{ 'font-mono': field.kind === 'other' }"
      class="w-full"
      size="sm"
      @update:model-value="(value: string) => set(field.name, value)"
    />
  </UFormField>
</template>
