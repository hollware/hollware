<script setup lang="ts">
import { computed } from 'vue'
import { useMessages } from '../i18n/index.ts'
import { fieldsOf, readFrontmatter, setField, type Field } from '../lib/frontmatter.ts'

const props = defineProps<{
  modelValue: string
  schema: Readonly<Record<string, unknown>>
  omit?: readonly string[]
}>()
const emit = defineEmits<{ 'update:modelValue': [value: string] }>()

const m = useMessages()
const fields = computed(() =>
  fieldsOf(props.schema).filter((field) => !(props.omit ?? []).includes(field.key)),
)
const values = computed(() => readFrontmatter(props.modelValue))

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
  <p v-else-if="fields.length === 0" class="text-sm text-muted">{{ m.frontmatter.noFields }}</p>
  <form v-else class="space-y-4" @submit.prevent>
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
      <UTextarea
        v-if="field.kind === 'long'"
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
</template>
