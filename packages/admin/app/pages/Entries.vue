<script setup lang="ts">
import type { TableColumn } from '@nuxt/ui'
import { computed, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import DataTable from '../components/DataTable.vue'
import Page from '../components/Page.vue'
import type { Output } from '../lib/api.ts'
import { sortable } from '../lib/columns.ts'
import { entryPath, STATUS_COLOR, titleOf, when } from '../lib/entries.ts'
import { api } from '../lib/session.ts'
import { pageUrl } from '../lib/site.ts'

type Site = Output<'describe_site'>['site']
type Entry = Output<'list_entries'>['entries'][number]
type Status = Entry['status']
/** A row of the table: the entry, with its title for the filter and the sorting. */
type Row = Entry & { title: string }

const ALL = 'all'
/** Entries are read 100 at a time, up to this many: the table pages, sorts and filters them. */
const MOST = 2000

const route = useRoute()
const router = useRouter()
const site = ref<Site | null>(null)
const entries = ref<Entry[]>([])
const loading = ref(false)
const truncated = ref(false)

// The filters of the server live in the query, so a filtered list can be linked to.
function queried(name: string, fallback: string): string {
  const value = route.query[name]
  return typeof value === 'string' && value !== '' ? value : fallback
}
const collection = ref(queried('collection', ''))
const locale = ref(queried('locale', ALL))
const status = ref(queried('status', ALL))

const definition = computed(() =>
  site.value?.collections.find((candidate) => candidate.name === collection.value),
)

onMounted(async () => {
  site.value = (await api.call('describe_site', {})).site
  if (!site.value.collections.some((candidate) => candidate.name === collection.value)) {
    collection.value = site.value.collections[0]?.name ?? ''
  }
  await load()
})

async function load() {
  if (collection.value === '') return
  loading.value = true
  try {
    const all: Entry[] = []
    let cursor: string | null = null
    do {
      const answer: Output<'list_entries'> = await api.call('list_entries', {
        collection: collection.value,
        limit: 100,
        ...(locale.value === ALL ? {} : { locale: locale.value }),
        ...(status.value === ALL ? {} : { status: status.value as Status }),
        ...(cursor === null ? {} : { cursor }),
      })
      all.push(...answer.entries)
      cursor = answer.nextCursor
    } while (cursor !== null && all.length < MOST)
    entries.value = all
    truncated.value = cursor !== null
  } finally {
    loading.value = false
  }
}

watch([collection, locale, status], async () => {
  await router.replace({
    query: Object.fromEntries(
      [
        ['collection', collection.value],
        ['locale', locale.value],
        ['status', status.value],
      ].filter(([, value]) => value !== '' && value !== ALL),
    ),
  })
  await load()
})

const rows = computed<Row[]>(() =>
  entries.value.map((entry) => ({ ...entry, title: titleOf(entry) })),
)

/** The other locales of each translation group among the loaded entries. */
const siblings = computed(() => {
  const groups = new Map<string, Entry[]>()
  for (const entry of entries.value) {
    if (entry.translationGroup === null) continue
    groups.set(entry.translationGroup, [...(groups.get(entry.translationGroup) ?? []), entry])
  }
  return groups
})
function translationsOf(entry: Entry): Entry[] {
  if (entry.translationGroup === null) return []
  return (siblings.value.get(entry.translationGroup) ?? []).filter((other) => other.id !== entry.id)
}

function liveUrl(entry: Entry): string | null {
  if (entry.status !== 'published' || definition.value === undefined) return null
  return pageUrl(site.value?.url ?? null, definition.value.routes, entry.locale, entry.slug)
}

const columns: TableColumn<Row>[] = [
  { accessorKey: 'title', header: sortable('Title') },
  { accessorKey: 'locale', header: sortable('Locale') },
  { accessorKey: 'status', header: sortable('Status') },
  { accessorKey: 'updatedAt', header: sortable('Updated') },
  { id: 'site', header: '' },
]

const statuses = [
  { label: 'Any status', value: ALL },
  { label: 'Draft', value: 'draft' },
  { label: 'Scheduled', value: 'scheduled' },
  { label: 'Published', value: 'published' },
]
const locales = computed(() => [
  { label: 'Any locale', value: ALL },
  ...(site.value?.locales ?? []).map((value) => ({ label: value, value })),
])
</script>

<template>
  <Page title="Entries">
    <template #actions>
      <UButton
        label="New entry"
        icon="i-lucide-plus"
        :to="{ path: '/entries/new', query: collection === '' ? {} : { collection } }"
      />
    </template>
    <DataTable
      :data="rows"
      :columns="columns"
      :loading="loading"
      filter-label="Filter by title, slug or tag"
      empty="No entries here yet."
    >
      <template #filters>
        <template v-if="site !== null">
          <USelect
            v-model="collection"
            :items="site.collections.map((c) => c.name)"
            aria-label="Collection"
            class="w-40"
          />
          <USelect v-model="locale" :items="locales" aria-label="Locale" class="w-36" />
          <USelect v-model="status" :items="statuses" aria-label="Status" class="w-36" />
        </template>
      </template>
      <template #title-cell="{ row }">
        <RouterLink
          :to="entryPath(row.original)"
          class="block max-w-md truncate font-medium hover:underline"
        >
          {{ row.original.title }}
        </RouterLink>
        <span class="block truncate font-mono text-xs text-muted">{{ row.original.slug }}</span>
      </template>
      <template #locale-cell="{ row }">
        <span class="font-mono">{{ row.original.locale }}</span>
        <RouterLink
          v-for="other in translationsOf(row.original)"
          :key="other.id"
          :to="entryPath(other)"
          :aria-label="`${titleOf(other)} (${other.locale})`"
          class="ml-1.5 font-mono text-xs text-muted hover:text-highlighted"
          >{{ other.locale }}</RouterLink
        >
      </template>
      <template #status-cell="{ row }">
        <UBadge
          :label="row.original.status"
          :color="STATUS_COLOR[row.original.status]"
          variant="subtle"
        />
        <UBadge
          v-if="row.original.status === 'published' && row.original.hasUnpublishedChanges"
          label="changes"
          color="warning"
          variant="outline"
          class="ml-1"
        />
        <span v-if="row.original.scheduledAt !== null" class="block text-xs text-muted">{{
          when(row.original.scheduledAt)
        }}</span>
      </template>
      <template #updatedAt-cell="{ row }">
        <span class="text-muted">{{ when(row.original.updatedAt) }}</span>
      </template>
      <template #site-cell="{ row }">
        <div class="text-right">
          <UButton
            v-if="liveUrl(row.original) !== null"
            :to="liveUrl(row.original) ?? undefined"
            target="_blank"
            icon="i-lucide-external-link"
            variant="ghost"
            size="sm"
            :aria-label="`${row.original.title} on the site`"
          />
        </div>
      </template>
    </DataTable>
    <p v-if="truncated" class="text-sm text-muted">
      The first {{ MOST }} entries: narrow the list by locale or status to see the others.
    </p>
  </Page>
</template>
