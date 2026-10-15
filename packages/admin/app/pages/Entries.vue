<script setup lang="ts">
import { onMounted, ref, watch } from 'vue'
import type { Output } from '../lib/api.ts'
import { api } from '../lib/session.ts'

type Site = Output<'describe_site'>['site']
type Entry = Output<'list_entries'>['entries'][number]

const site = ref<Site | null>(null)
const collection = ref('')
const entries = ref<Entry[]>([])
const loading = ref(false)

onMounted(async () => {
  const described = await api.call('describe_site', {})
  site.value = described.site
  collection.value = described.site.collections[0]?.name ?? ''
})

watch(collection, async (name) => {
  if (name === '') return
  loading.value = true
  try {
    entries.value = (await api.call('list_entries', { collection: name, limit: 100 })).entries
  } finally {
    loading.value = false
  }
})

function titleOf(entry: Entry): string {
  const title = entry.frontmatter['title']
  return typeof title === 'string' && title !== '' ? title : entry.slug
}

const STATUS_COLOR = { draft: 'neutral', scheduled: 'info', published: 'success' } as const
</script>

<template>
  <div class="space-y-4">
    <div class="flex flex-wrap items-center gap-3">
      <h1 class="text-xl font-semibold">Entries</h1>
      <USelect
        v-if="site !== null"
        v-model="collection"
        :items="site.collections.map((c) => c.name)"
        aria-label="Collection"
        class="w-48"
      />
      <UButton class="ml-auto" label="New entry" icon="i-lucide-plus" to="/entries/new" />
    </div>
    <p v-if="loading" class="text-muted">Loading…</p>
    <p v-else-if="entries.length === 0" class="text-muted">No entries yet.</p>
    <table v-else class="w-full text-sm">
      <thead class="text-left text-muted">
        <tr>
          <th class="py-2">Title</th>
          <th>Locale</th>
          <th>Status</th>
          <th>Updated</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="entry in entries" :key="entry.id" class="border-t border-default">
          <td class="py-2">
            <RouterLink
              :to="`/entries/${entry.collection}/${entry.locale}/${entry.slug}`"
              class="font-medium hover:underline"
            >
              {{ titleOf(entry) }}
            </RouterLink>
          </td>
          <td>{{ entry.locale }}</td>
          <td>
            <UBadge :label="entry.status" :color="STATUS_COLOR[entry.status]" variant="subtle" />
            <UBadge
              v-if="entry.status === 'published' && entry.hasUnpublishedChanges"
              label="changes"
              color="warning"
              variant="outline"
              class="ml-1"
            />
          </td>
          <td class="text-muted">{{ new Date(entry.updatedAt).toLocaleString() }}</td>
        </tr>
      </tbody>
    </table>
  </div>
</template>
