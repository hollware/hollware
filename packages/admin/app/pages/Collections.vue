<script setup lang="ts">
import type { TableColumn } from '@nuxt/ui'
import DataTable from '../components/DataTable.vue'
import Page from '../components/Page.vue'
import { sortable } from '../lib/columns.ts'
import { useToast } from '@nuxt/ui/composables'
import { computed, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import StructureDialogs from '../components/StructureDialogs.vue'
import type { Output } from '../lib/api.ts'
import { collectionPreset, type Preset } from '@hollware/core'
import { useMessages } from '../i18n/index.ts'
import { api } from '../lib/session.ts'
import { useStructureChange } from '../lib/structure.ts'

const toast = useToast()
const m = useMessages()
const router = useRouter()
const structure = ref<Output<'get_structure'> | null>(null)
const name = ref('')
const preset = ref<Preset>('blog')

async function load() {
  structure.value = await api.call('get_structure', {})
}
onMounted(load)

const collections = computed(() => Object.entries(structure.value?.definition.collections ?? {}))
type Row = { name: string; fields: number; rules: number; path: string }
const rows = computed<Row[]>(() =>
  collections.value.map(([name, collection]) => ({
    name,
    fields: fieldCount(collection.schema),
    rules: collection.rules.length,
    path: Object.values(collection.routes)[0] ?? '',
  })),
)
const columns = computed<TableColumn<Row>[]>(() => [
  { accessorKey: 'name', header: sortable(m.value.collections.columns.name) },
  { accessorKey: 'fields', header: sortable(m.value.collections.columns.fields) },
  { accessorKey: 'rules', header: sortable(m.value.collections.columns.rules) },
  { accessorKey: 'path', header: m.value.collections.columns.path },
])

const validName = computed(
  () =>
    /^[a-z][a-z0-9-]*$/.test(name.value) &&
    structure.value?.definition.collections[name.value] === undefined,
)

const change = useStructureChange(async () => {
  toast.add({ title: m.value.collections.created(name.value), color: 'success' })
  await router.push(`/collections/${name.value}`)
})

async function create() {
  const current = structure.value
  if (current === null || !validName.value) return
  const collection = collectionPreset(
    preset.value,
    name.value,
    current.definition.locales,
    current.definition.defaultLocale,
  )
  await change.run((confirm) =>
    api.call('set_collection', { version: current.version, name: name.value, collection, confirm }),
  )
}

/** How many fields a collection's schema declares. */
function fieldCount(schema: Readonly<Record<string, unknown>>): number {
  const properties = schema['properties']
  return typeof properties === 'object' && properties !== null ? Object.keys(properties).length : 0
}

const PRESETS = computed(() => [
  { label: m.value.collections.presets.blog, value: 'blog' },
  { label: m.value.collections.presets.docs, value: 'docs' },
  { label: m.value.collections.presets.empty, value: 'empty' },
])
</script>

<template>
  <Page :title="m.collections.title" :description="m.collections.description">
    <div class="space-y-8">
      <p v-if="structure === null" class="text-muted">{{ m.common.loading }}</p>
      <DataTable
        v-else
        :data="rows"
        :columns="columns"
        :filter-label="m.collections.filter"
        :empty="m.collections.empty"
      >
        <template #name-cell="{ row }">
          <RouterLink
            :to="`/collections/${row.original.name}`"
            class="font-medium hover:underline"
            >{{ row.original.name }}</RouterLink
          >
        </template>
        <template #path-cell="{ row }">
          <span class="font-mono text-xs text-muted">{{ row.original.path }}</span>
        </template>
      </DataTable>

      <form class="max-w-lg space-y-4" @submit.prevent="create">
        <h2 class="font-semibold">{{ m.collections.newCollection }}</h2>
        <UFormField
          :label="m.common.name"
          :help="m.collections.nameHelp"
          :error="name !== '' && !validName ? m.collections.notFree : undefined"
        >
          <UInput v-model="name" class="w-full font-mono" />
        </UFormField>
        <UFormField :label="m.common.startFrom">
          <USelect v-model="preset" :items="PRESETS" class="w-full" />
        </UFormField>
        <UButton
          type="submit"
          :label="m.collections.create"
          :disabled="!validName"
          :loading="change.busy.value"
        />
        <StructureDialogs
          :impact="change.impact.value"
          :problems="change.problems.value"
          :conflict="change.conflict.value"
          :failure="change.failure.value"
          @confirm="change.confirmPending"
          @cancel="change.cancel"
          @reload="load"
        />
      </form>
    </div>
  </Page>
</template>
