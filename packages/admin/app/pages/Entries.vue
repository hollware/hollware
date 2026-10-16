<script setup lang="ts">
import Page from '../components/Page.vue'
import { computed, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import type { Output } from '../lib/api.ts'
import { entryPath, STATUS_COLOR, titleOf, when } from '../lib/entries.ts'
import { api } from '../lib/session.ts'
import { pageUrl } from '../lib/site.ts'

type Site = Output<'describe_site'>['site']
type Entry = Output<'list_entries'>['entries'][number]
type Status = Entry['status']

const ALL = 'all'
const PAGE = 50

const route = useRoute()
const router = useRouter()
const site = ref<Site | null>(null)
const entries = ref<Entry[]>([])
const cursor = ref<string | null>(null)
const loading = ref(false)

// The filters live in the query, so a filtered list can be linked to and comes back on Back.
function queried(name: string, fallback: string): string {
  const value = route.query[name]
  return typeof value === 'string' && value !== '' ? value : fallback
}
const collection = ref(queried('collection', ''))
const locale = ref(queried('locale', ALL))
const status = ref(queried('status', ALL))
const text = ref(queried('q', ''))

const definition = computed(() =>
  site.value?.collections.find((candidate) => candidate.name === collection.value),
)

onMounted(async () => {
  site.value = (await api.call('describe_site', {})).site
  if (!site.value.collections.some((candidate) => candidate.name === collection.value)) {
    collection.value = site.value.collections[0]?.name ?? ''
  }
  await load(false)
})

async function load(more: boolean) {
  if (collection.value === '') return
  loading.value = true
  try {
    const answer = await api.call('list_entries', {
      collection: collection.value,
      limit: PAGE,
      ...(locale.value === ALL ? {} : { locale: locale.value }),
      ...(status.value === ALL ? {} : { status: status.value as Status }),
      ...(more && cursor.value !== null ? { cursor: cursor.value } : {}),
    })
    entries.value = more ? [...entries.value, ...answer.entries] : answer.entries
    cursor.value = answer.nextCursor
  } finally {
    loading.value = false
  }
}

watch([collection, locale, status], async () => {
  await router.replace({ query: filters() })
  await load(false)
})
watch(text, async () => {
  await router.replace({ query: filters() })
})

function filters(): Record<string, string> {
  return Object.fromEntries(
    [
      ['collection', collection.value],
      ['locale', locale.value],
      ['status', status.value],
      ['q', text.value],
    ].filter(([, value]) => value !== '' && value !== ALL),
  )
}

/** The loaded entries that hold every word of the text filter, in their title, slug or tags. */
const shown = computed(() => {
  const words = text.value.toLowerCase().split(/\s+/).filter(Boolean)
  if (words.length === 0) return entries.value
  return entries.value.filter((entry) => {
    const haystack = [titleOf(entry), entry.slug, ...entry.tags].join(' ').toLowerCase()
    return words.every((word) => haystack.includes(word))
  })
})

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
    <div class="space-y-5">
      <div v-if="site !== null" class="flex flex-wrap items-center gap-2">
        <USelect
          v-model="collection"
          :items="site.collections.map((c) => c.name)"
          aria-label="Collection"
          class="w-40"
        />
        <USelect v-model="locale" :items="locales" aria-label="Locale" class="w-36" />
        <USelect v-model="status" :items="statuses" aria-label="Status" class="w-36" />
        <UInput
          v-model="text"
          icon="i-lucide-search"
          placeholder="Filter by title, slug or tag"
          aria-label="Filter"
          class="min-w-0 flex-1 basis-56"
        />
      </div>

      <p v-if="loading && entries.length === 0" class="text-muted">Loading…</p>
      <p v-else-if="shown.length === 0" class="text-muted">
        {{ entries.length === 0 ? 'No entries here yet.' : 'No loaded entry matches the filter.' }}
      </p>
      <div v-else class="overflow-x-auto rounded-lg border border-default">
        <table class="w-full text-sm">
          <thead class="bg-elevated/50 text-left text-xs tracking-wide text-muted uppercase">
            <tr>
              <th class="px-4 py-2 font-medium">Title</th>
              <th class="px-4 py-2 font-medium">Locale</th>
              <th class="px-4 py-2 font-medium">Status</th>
              <th class="px-4 py-2 font-medium">Updated</th>
              <th class="px-4 py-2"><span class="sr-only">On the site</span></th>
            </tr>
          </thead>
          <tbody class="divide-y divide-default">
            <tr v-for="entry in shown" :key="entry.id">
              <td class="max-w-0 px-4 py-2.5">
                <RouterLink
                  :to="entryPath(entry)"
                  class="block truncate font-medium hover:underline"
                >
                  {{ titleOf(entry) }}
                </RouterLink>
                <span class="block truncate font-mono text-xs text-muted">{{ entry.slug }}</span>
              </td>
              <td class="px-4 py-2.5 whitespace-nowrap">
                <span class="font-mono">{{ entry.locale }}</span>
                <RouterLink
                  v-for="other in translationsOf(entry)"
                  :key="other.id"
                  :to="entryPath(other)"
                  :aria-label="`${titleOf(other)} (${other.locale})`"
                  class="ml-1.5 font-mono text-xs text-muted hover:text-highlighted"
                  >{{ other.locale }}</RouterLink
                >
              </td>
              <td class="px-4 py-2.5 whitespace-nowrap">
                <UBadge
                  :label="entry.status"
                  :color="STATUS_COLOR[entry.status]"
                  variant="subtle"
                />
                <UBadge
                  v-if="entry.status === 'published' && entry.hasUnpublishedChanges"
                  label="changes"
                  color="warning"
                  variant="outline"
                  class="ml-1"
                />
                <span v-if="entry.scheduledAt !== null" class="block text-xs text-muted">{{
                  when(entry.scheduledAt)
                }}</span>
              </td>
              <td class="px-4 py-2.5 whitespace-nowrap text-muted">{{ when(entry.updatedAt) }}</td>
              <td class="px-4 py-2.5 text-right">
                <UButton
                  v-if="liveUrl(entry) !== null"
                  :to="liveUrl(entry) ?? undefined"
                  target="_blank"
                  icon="i-lucide-external-link"
                  variant="ghost"
                  size="sm"
                  :aria-label="`${titleOf(entry)} on the site`"
                />
              </td>
            </tr>
          </tbody>
        </table>
      </div>
      <div v-if="cursor !== null" class="flex justify-center">
        <UButton label="Load more" variant="outline" :loading="loading" @click="load(true)" />
      </div>
    </div>
  </Page>
</template>
