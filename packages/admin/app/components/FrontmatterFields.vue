<script setup lang="ts">
import { useMessages } from '../i18n/index.ts'
import { itemTitle, newItem, valueAt, type Field, type Path } from '../lib/frontmatter.ts'

const props = defineProps<{
  fields: readonly Field[]
  values: unknown
  path: Path
  references?: Readonly<Record<string, unknown>>
  choices?: Readonly<Record<string, readonly { label: string; value: string }[]>>
}>()
const emit = defineEmits<{
  set: [path: Path, value: unknown]
  add: [path: Path, item: unknown]
  remove: [path: Path, index: number]
  move: [path: Path, from: number, to: number]
  pick: [path: Path]
}>()

const m = useMessages()

function at(field: Field): Path {
  return [...props.path, field.key]
}
function raw(field: Field): unknown {
  return valueAt(props.values, [field.key])
}
function text(field: Field): string {
  const value = raw(field)
  return value === undefined || value === null ? '' : String(value)
}
function list(field: Field): string[] {
  const value = raw(field)
  return Array.isArray(value) ? value.map(String) : []
}
function items(field: Field): unknown[] {
  const value = raw(field)
  return Array.isArray(value) ? value : []
}
function number(field: Field): number | undefined {
  const value = raw(field)
  return typeof value === 'number' ? value : undefined
}
function referenced(field: Field): boolean {
  return (
    props.references?.[field.key] !== undefined && (field.kind === 'text' || field.kind === 'list')
  )
}
function itemName(field: Field, item: unknown, index: number): string {
  return itemTitle(item, field.fields) ?? m.value.frontmatter.item(field.key, index + 1)
}
function set(field: Field, value: unknown) {
  emit('set', at(field), value)
}
</script>

<template>
  <template v-for="field in fields" :key="field.key">
    <fieldset
      v-if="field.kind === 'object'"
      class="space-y-3 rounded-md border border-default p-3"
      :aria-describedby="field.description === null ? undefined : `${at(field).join('.')}-help`"
    >
      <legend class="px-1 text-sm font-medium text-highlighted">
        {{ field.key }}<span v-if="field.required" class="text-error" aria-hidden="true">*</span>
      </legend>
      <p
        v-if="field.description !== null"
        :id="`${at(field).join('.')}-help`"
        class="text-xs text-muted"
      >
        {{ field.description }}
      </p>
      <FrontmatterFields
        :fields="field.fields"
        :values="raw(field)"
        :path="at(field)"
        @set="(path, value) => emit('set', path, value)"
        @add="(path, item) => emit('add', path, item)"
        @remove="(path, index) => emit('remove', path, index)"
        @move="(path, from, to) => emit('move', path, from, to)"
        @pick="(path) => emit('pick', path)"
      />
    </fieldset>
    <fieldset v-else-if="field.kind === 'objects'" class="space-y-2">
      <legend class="mb-1 text-sm font-medium text-highlighted">
        {{ field.key }}<span v-if="field.required" class="text-error" aria-hidden="true">*</span>
      </legend>
      <p v-if="field.description !== null" class="text-xs text-muted">{{ field.description }}</p>
      <p v-if="items(field).length === 0" class="text-xs text-dimmed">
        {{ m.frontmatter.noItems }}
      </p>
      <ol class="space-y-2">
        <li
          v-for="(item, index) in items(field)"
          :key="index"
          class="space-y-3 rounded-md border border-default p-3"
          :aria-label="itemName(field, item, index)"
        >
          <div class="flex items-center gap-1">
            <span class="min-w-0 flex-1 truncate text-xs font-medium text-muted">
              {{ itemName(field, item, index) }}
            </span>
            <UTooltip :text="m.frontmatter.moveUp(itemName(field, item, index))">
              <UButton
                icon="i-lucide-arrow-up"
                size="xs"
                color="neutral"
                variant="ghost"
                :disabled="index === 0"
                :aria-label="m.frontmatter.moveUp(itemName(field, item, index))"
                @click="emit('move', at(field), index, index - 1)"
              />
            </UTooltip>
            <UTooltip :text="m.frontmatter.moveDown(itemName(field, item, index))">
              <UButton
                icon="i-lucide-arrow-down"
                size="xs"
                color="neutral"
                variant="ghost"
                :disabled="index === items(field).length - 1"
                :aria-label="m.frontmatter.moveDown(itemName(field, item, index))"
                @click="emit('move', at(field), index, index + 1)"
              />
            </UTooltip>
            <UTooltip :text="m.frontmatter.removeItem(itemName(field, item, index))">
              <UButton
                icon="i-lucide-trash-2"
                size="xs"
                color="neutral"
                variant="ghost"
                :aria-label="m.frontmatter.removeItem(itemName(field, item, index))"
                @click="emit('remove', at(field), index)"
              />
            </UTooltip>
          </div>
          <FrontmatterFields
            :fields="field.fields"
            :values="item"
            :path="[...at(field), index]"
            @set="(path, value) => emit('set', path, value)"
            @add="(path, added) => emit('add', path, added)"
            @remove="(path, removed) => emit('remove', path, removed)"
            @move="(path, from, to) => emit('move', path, from, to)"
            @pick="(path) => emit('pick', path)"
          />
        </li>
      </ol>
      <UButton
        :label="m.frontmatter.addItem(field.key)"
        icon="i-lucide-plus"
        size="xs"
        color="neutral"
        variant="outline"
        @click="emit('add', at(field), newItem(field.fields))"
      />
    </fieldset>
    <UFormField
      v-else
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
        v-if="referenced(field)"
        :model-value="field.kind === 'list' ? list(field) : text(field)"
        :items="[...(choices?.[field.key] ?? [])]"
        value-key="value"
        :multiple="field.kind === 'list'"
        :placeholder="m.frontmatter.pickEntry"
        class="w-full"
        @update:model-value="set(field, $event)"
      />
      <div v-else-if="field.kind === 'image'" class="flex items-center gap-2">
        <UInput
          :model-value="text(field)"
          class="min-w-0 flex-1 font-mono"
          @update:model-value="set(field, $event === '' ? undefined : $event)"
        />
        <UButton
          :label="m.frontmatter.chooseImage"
          icon="i-lucide-image"
          color="neutral"
          variant="outline"
          @click="emit('pick', at(field))"
        />
      </div>
      <UTextarea
        v-else-if="field.kind === 'long'"
        :model-value="text(field)"
        :rows="3"
        autoresize
        class="w-full"
        @update:model-value="set(field, $event)"
      />
      <UInput
        v-else-if="field.kind === 'date'"
        type="date"
        :model-value="text(field)"
        class="w-full"
        @update:model-value="set(field, $event)"
      />
      <USelect
        v-else-if="field.kind === 'choice'"
        :model-value="text(field)"
        :items="[...field.options]"
        class="w-full"
        @update:model-value="set(field, $event)"
      />
      <USelectMenu
        v-else-if="field.kind === 'choices'"
        :model-value="list(field)"
        :items="[...field.options]"
        multiple
        :placeholder="m.frontmatter.pickMany"
        class="w-full"
        @update:model-value="set(field, $event)"
      />
      <UInputTags
        v-else-if="field.kind === 'list'"
        :model-value="list(field)"
        class="w-full"
        @update:model-value="set(field, $event)"
      />
      <UInputNumber
        v-else-if="field.kind === 'number'"
        :model-value="number(field)"
        class="w-full"
        @update:model-value="set(field, $event)"
      />
      <USwitch
        v-else-if="field.kind === 'switch'"
        :model-value="raw(field) === true"
        @update:model-value="set(field, $event)"
      />
      <UInput
        v-else
        :model-value="text(field)"
        class="w-full"
        @update:model-value="set(field, $event)"
      />
    </UFormField>
  </template>
</template>
