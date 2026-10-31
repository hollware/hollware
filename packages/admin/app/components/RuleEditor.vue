<script setup lang="ts">
import { computed } from 'vue'
import type { Output } from '../lib/api.ts'
import { paramInputs } from '../lib/params.ts'
import { useMessages } from '../i18n/index.ts'

type Rule = Output<'get_structure'>['definition']['collections'][string]['rules'][number]
type CatalogRule = Output<'get_structure'>['catalog'][number]

const rule = defineModel<Rule>('rule', { required: true })
const props = defineProps<{
  catalog: readonly CatalogRule[]
  fields: readonly string[]
}>()
const emit = defineEmits<{ remove: [] }>()

const entry = computed(() => props.catalog.find((candidate) => candidate.name === rule.value.rule))
const inputs = computed(() => (entry.value === undefined ? [] : paramInputs(entry.value.params)))
const m = useMessages()
const NONE = computed(() => m.value.common.none)
const severities = computed(() => [
  { label: m.value.severity.error, value: 'error' },
  { label: m.value.severity.warning, value: 'warning' },
])
const names = computed(() => props.catalog.map((candidate) => candidate.name))

function value(key: string): unknown {
  return rule.value.params[key]
}
function texts(key: string): string[] {
  const found = value(key)
  return Array.isArray(found) ? found.map(String) : []
}
function numberOf(key: string): number | undefined {
  const found = value(key)
  return typeof found === 'number' ? found : undefined
}
function set(key: string, next: unknown) {
  rule.value = { ...rule.value, params: { ...rule.value.params, [key]: next } }
}
function setRule(name: string) {
  rule.value = { ...rule.value, rule: name, params: {} }
}
function setSeverity(severity: Rule['severity']) {
  rule.value = { ...rule.value, severity }
}
</script>

<template>
  <div class="space-y-3 rounded-lg border border-default p-4">
    <div class="flex flex-wrap items-end gap-3">
      <UFormField :label="m.rule.rule" class="min-w-0 flex-1">
        <USelect
          :model-value="rule.rule"
          :items="names"
          class="w-full"
          @update:model-value="setRule(String($event))"
        />
      </UFormField>
      <UFormField :label="m.rule.severity">
        <USelect
          :model-value="rule.severity"
          :items="severities"
          class="w-32"
          @update:model-value="setSeverity"
        />
      </UFormField>
      <UButton
        icon="i-lucide-trash-2"
        color="error"
        variant="ghost"
        :aria-label="m.rule.remove(rule.rule)"
        @click="emit('remove')"
      />
    </div>
    <p v-if="entry !== undefined" class="text-sm text-muted">{{ entry.description }}</p>
    <div v-if="inputs.length > 0" class="grid gap-3 sm:grid-cols-2">
      <UFormField
        v-for="input in inputs"
        :key="input.key"
        :label="input.key"
        :required="input.required"
        :help="input.description ?? undefined"
      >
        <USelect
          v-if="input.kind === 'field'"
          :model-value="typeof value(input.key) === 'string' ? String(value(input.key)) : NONE"
          :items="input.required ? [...fields] : [NONE, ...fields]"
          class="w-full"
          @update:model-value="set(input.key, $event === NONE ? undefined : $event)"
        />
        <USelectMenu
          v-else-if="input.kind === 'fields'"
          :model-value="texts(input.key)"
          :items="[...fields]"
          multiple
          class="w-full"
          @update:model-value="set(input.key, $event)"
        />
        <UInputNumber
          v-else-if="input.kind === 'number'"
          :model-value="numberOf(input.key)"
          class="w-full"
          @update:model-value="set(input.key, $event)"
        />
        <UInputTags
          v-else-if="input.kind === 'texts'"
          :model-value="texts(input.key)"
          class="w-full"
          @update:model-value="set(input.key, $event)"
        />
        <UInput
          v-else
          :model-value="String(value(input.key) ?? '')"
          class="w-full"
          @update:model-value="set(input.key, $event)"
        />
      </UFormField>
    </div>
  </div>
</template>
