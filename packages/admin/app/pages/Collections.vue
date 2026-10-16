<script setup lang="ts">
import { useToast } from '@nuxt/ui/composables'
import { computed, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import StructureDialogs from '../components/StructureDialogs.vue'
import type { Output } from '../lib/api.ts'
import { collectionPreset, type Preset } from '@hollware/core'
import { api } from '../lib/session.ts'
import { useStructureChange } from '../lib/structure.ts'

const toast = useToast()
const router = useRouter()
const structure = ref<Output<'get_structure'> | null>(null)
const name = ref('')
const preset = ref<Preset>('blog')

async function load() {
  structure.value = await api.call('get_structure', {})
}
onMounted(load)

const collections = computed(() => Object.entries(structure.value?.definition.collections ?? {}))
const validName = computed(
  () =>
    /^[a-z][a-z0-9-]*$/.test(name.value) &&
    structure.value?.definition.collections[name.value] === undefined,
)

const change = useStructureChange(async () => {
  toast.add({ title: `The collection ${name.value} is there`, color: 'success' })
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

const PRESETS = [
  { label: 'A blog: title, description, date, tags', value: 'blog' },
  { label: 'Docs: title, description, order', value: 'docs' },
  { label: 'Empty: a title alone', value: 'empty' },
]
</script>

<template>
  <div class="space-y-8">
    <div>
      <h1 class="text-xl font-semibold">Collections</h1>
      <p class="text-sm text-muted">
        The kinds of entry of this site, with their fields and rules. A change applies at once.
      </p>
    </div>
    <p v-if="structure === null" class="text-muted">Loading…</p>
    <ul v-else class="divide-y divide-default rounded-lg border border-default">
      <li v-for="[key, collection] in collections" :key="key">
        <RouterLink
          :to="`/collections/${key}`"
          class="flex flex-wrap items-center gap-3 px-4 py-3 hover:bg-elevated"
        >
          <span class="font-medium">{{ key }}</span>
          <span class="text-sm text-muted">
            {{ fieldCount(collection.schema) }}
            fields · {{ collection.rules.length }} rules
          </span>
          <span class="ml-auto font-mono text-xs text-muted">{{
            Object.values(collection.routes)[0]
          }}</span>
        </RouterLink>
      </li>
    </ul>

    <form class="max-w-lg space-y-4" @submit.prevent="create">
      <h2 class="font-semibold">New collection</h2>
      <UFormField
        label="Name"
        help="Lowercase letters, digits and hyphens, such as talks."
        :error="name !== '' && !validName ? 'Not a free name.' : undefined"
      >
        <UInput v-model="name" class="w-full font-mono" />
      </UFormField>
      <UFormField label="Start from">
        <USelect v-model="preset" :items="PRESETS" class="w-full" />
      </UFormField>
      <UButton
        type="submit"
        label="Create the collection"
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
</template>
