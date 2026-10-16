<script setup lang="ts">
import type { TableColumn } from '@nuxt/ui'
import { computed, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import DataTable from '../components/DataTable.vue'
import Page from '../components/Page.vue'
import type { Output } from '../lib/api.ts'
import { countOutcomes, runAll } from '../lib/bulk.ts'
import { useBulkReport } from '../lib/bulk-report.ts'
import { sortable } from '../lib/columns.ts'
import { formatDateTime, useMessages } from '../i18n/index.ts'
import { entryPath, STATUS_COLOR, titleOf } from '../lib/entries.ts'
import { api } from '../lib/session.ts'
import { pageUrl } from '../lib/site.ts'

type Site = Output<'describe_site'>['site']
type Entry = Output<'list_entries'>['entries'][number]
type Status = Entry['status']
/** A row of the table: the entry, with its title for the filter and the sorting. */
type Row = Entry & { title: string }
type Warning = Output<'validate'>['verdict']['warnings'][number]

const ALL = 'all'
/** The status filter that lists the trash instead of a status. */
const TRASH = 'trash'
/** Entries are read 100 at a time, up to this many: the table pages, sorts and filters them. */
const MOST = 2000

const m = useMessages()
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

const inTrash = computed(() => status.value === TRASH)

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
        ...(status.value === ALL
          ? {}
          : status.value === TRASH
            ? { trashed: true }
            : { status: status.value as Status }),
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

const columns = computed<TableColumn<Row>[]>(() => [
  { accessorKey: 'title', header: sortable(m.value.entries.columns.title) },
  { accessorKey: 'locale', header: sortable(m.value.entries.columns.locale) },
  { accessorKey: 'status', header: sortable(m.value.entries.columns.status) },
  { accessorKey: 'updatedAt', header: sortable(m.value.entries.columns.updated) },
  { id: 'site', header: '' },
])

/**
 * Bulk actions on the chosen entries, each the operation of one entry: publish (or schedule) what
 * has something to publish, and unpublish what is published or scheduled. Entries whose warnings
 * have to be accepted come back together, to be accepted at once.
 */
const reportBulk = useBulkReport()
const busy = ref(false)
const publishable = (entry: Row) =>
  entry.deletedAt === null && (entry.status !== 'published' || entry.hasUnpublishedChanges)
const unpublishable = (entry: Row) => entry.deletedAt === null && entry.status !== 'draft'
// Only a draft goes to the trash; what is published or scheduled is unpublished first.
const trashable = (entry: Row) => entry.deletedAt === null && entry.status === 'draft'
const restorable = (entry: Row) => entry.deletedAt !== null

const unpublishing = ref<Row[]>([])
const trashing = ref<Row[]>([])
const scheduling = ref<Row[]>([])
const publishAt = ref('')
const warned = ref<{ row: Row; warnings: Warning[] }[]>([])
let warnedAt: string | undefined
const open = (list: { value: unknown[] }) =>
  computed({
    get: () => list.value.length > 0,
    set: (value: boolean) => {
      if (!value) list.value = []
    },
  })
const unpublishOpen = open(unpublishing)
const trashOpen = open(trashing)
const scheduleOpen = open(scheduling)
const warnedOpen = open(warned)

async function publishMany(
  rows: readonly Row[],
  at?: string,
  acknowledged: ReadonlyMap<string, readonly Warning[]> = new Map(),
) {
  busy.value = true
  scheduling.value = []
  warned.value = []
  try {
    const results = await runAll(rows, (row) =>
      api.call('publish', {
        id: row.id,
        version: row.version,
        acknowledgeWarnings: (acknowledged.get(row.id) ?? []).map(({ contract, path }) => ({
          contract,
          path,
        })),
        ...(at === undefined ? {} : { publishAt: at }),
      }),
    )
    reportBulk(countOutcomes(results))
    await load()
    warnedAt = at
    warned.value = results.flatMap((result) =>
      'answer' in result && result.answer.outcome === 'needs_acknowledgement'
        ? [{ row: result.item, warnings: result.answer.verdict?.warnings ?? [] }]
        : [],
    )
  } finally {
    busy.value = false
  }
}

async function acceptWarnings() {
  const accepted = new Map(warned.value.map(({ row, warnings }) => [row.id, warnings]))
  await publishMany(
    warned.value.map(({ row }) => row),
    warnedAt,
    accepted,
  )
}

function openSchedule(rows: readonly Row[]) {
  // An hour from now, to the minute, in the person's own zone: what a datetime-local input shows.
  const soon = new Date(Date.now() + 3_600_000)
  soon.setSeconds(0, 0)
  publishAt.value = new Date(soon.getTime() - soon.getTimezoneOffset() * 60_000)
    .toISOString()
    .slice(0, 16)
  scheduling.value = [...rows]
}
const scheduleError = computed(() => {
  const at = Date.parse(publishAt.value)
  if (Number.isNaN(at)) return m.value.entry.pickDateTime
  return at <= Date.now() ? m.value.entry.pickFuture : null
})

async function unpublishMany() {
  const rows = unpublishing.value
  unpublishing.value = []
  busy.value = true
  try {
    reportBulk(countOutcomes(await runAll(rows, (row) => api.call('unpublish', { id: row.id }))))
    await load()
  } finally {
    busy.value = false
  }
}

async function trashMany() {
  const rows = trashing.value
  trashing.value = []
  busy.value = true
  try {
    const results = await runAll(rows, async (row) => {
      const answer = await api.call('delete_entry', { id: row.id, version: row.version })
      // `published` refuses the trash: the entry was published or scheduled meanwhile.
      return { outcome: answer.outcome === 'published' ? 'not_draft' : answer.outcome }
    })
    reportBulk(countOutcomes(results))
    await load()
  } finally {
    busy.value = false
  }
}

async function restoreMany(rows: readonly Row[]) {
  busy.value = true
  try {
    reportBulk(
      countOutcomes(await runAll(rows, (row) => api.call('restore_entry', { id: row.id }))),
    )
    await load()
  } finally {
    busy.value = false
  }
}

const statuses = computed(() => [
  { label: m.value.entries.anyStatus, value: ALL },
  { label: m.value.entries.draft, value: 'draft' },
  { label: m.value.entries.scheduled, value: 'scheduled' },
  { label: m.value.entries.published, value: 'published' },
  { label: m.value.entries.trash, value: TRASH },
])
const locales = computed(() => [
  { label: m.value.entries.anyLocale, value: ALL },
  ...(site.value?.locales ?? []).map((value) => ({ label: value, value })),
])
</script>

<template>
  <Page :title="m.entries.title">
    <template #actions>
      <UButton
        :label="m.entries.newEntry"
        icon="i-lucide-plus"
        :to="{ path: '/entries/new', query: collection === '' ? {} : { collection } }"
      />
    </template>
    <DataTable
      :data="rows"
      :columns="columns"
      :loading="loading"
      :filter-label="m.entries.filter"
      :empty="m.entries.empty"
      selectable
      :row-label="(row: Row) => row.title"
    >
      <template #bulk="{ selected }">
        <UButton
          v-if="selected.some(publishable)"
          :label="m.bulk.publish(selected.filter(publishable).length)"
          icon="i-lucide-send"
          size="sm"
          :loading="busy"
          @click="publishMany(selected.filter(publishable))"
        />
        <UButton
          v-if="selected.some(publishable)"
          :label="m.bulk.schedule(selected.filter(publishable).length)"
          icon="i-lucide-calendar-clock"
          variant="outline"
          size="sm"
          :disabled="busy"
          @click="openSchedule(selected.filter(publishable))"
        />
        <UButton
          v-if="selected.some(unpublishable)"
          :label="m.bulk.unpublish(selected.filter(unpublishable).length)"
          icon="i-lucide-eye-off"
          color="error"
          variant="outline"
          size="sm"
          :disabled="busy"
          @click="unpublishing = selected.filter(unpublishable)"
        />
        <UButton
          v-if="selected.some(trashable)"
          :label="m.bulk.trash(selected.filter(trashable).length)"
          icon="i-lucide-trash-2"
          color="error"
          variant="outline"
          size="sm"
          :disabled="busy"
          @click="trashing = selected.filter(trashable)"
        />
        <UButton
          v-if="selected.some(restorable)"
          :label="m.bulk.restore(selected.filter(restorable).length)"
          icon="i-lucide-undo-2"
          size="sm"
          :loading="busy"
          @click="restoreMany(selected.filter(restorable))"
        />
      </template>
      <template #filters>
        <template v-if="site !== null">
          <USelect
            v-model="collection"
            :items="site.collections.map((c) => c.name)"
            :aria-label="m.entries.collection"
            class="w-40"
          />
          <USelect v-model="locale" :items="locales" :aria-label="m.entries.locale" class="w-44" />
          <USelect v-model="status" :items="statuses" :aria-label="m.entries.status" class="w-44" />
        </template>
      </template>
      <template #title-cell="{ row }">
        <!-- An entry in the trash has no page until it is restored. -->
        <span v-if="row.original.deletedAt !== null" class="block max-w-md truncate font-medium">
          {{ row.original.title }}
        </span>
        <RouterLink
          v-else
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
          :label="m.status[row.original.status]"
          :color="STATUS_COLOR[row.original.status]"
          variant="subtle"
        />
        <UBadge
          v-if="row.original.status === 'published' && row.original.hasUnpublishedChanges"
          :label="m.entries.changes"
          color="warning"
          variant="outline"
          class="ml-1"
        />
        <span v-if="row.original.scheduledAt !== null" class="block text-xs text-muted">{{
          formatDateTime(row.original.scheduledAt)
        }}</span>
      </template>
      <template #updatedAt-cell="{ row }">
        <span class="text-muted">{{ formatDateTime(row.original.updatedAt) }}</span>
      </template>
      <template #site-cell="{ row }">
        <div class="text-right">
          <UButton
            v-if="row.original.deletedAt !== null"
            :label="m.entries.restore"
            :aria-label="m.entries.restoreOne(row.original.title)"
            icon="i-lucide-undo-2"
            variant="outline"
            size="sm"
            :disabled="busy"
            @click="restoreMany([row.original])"
          />
          <UButton
            v-if="liveUrl(row.original) !== null"
            :to="liveUrl(row.original) ?? undefined"
            target="_blank"
            icon="i-lucide-external-link"
            variant="ghost"
            size="sm"
            :aria-label="m.entries.onSite(row.original.title)"
          />
        </div>
      </template>
    </DataTable>
    <p v-if="truncated" class="text-sm text-muted">
      {{ m.entries.truncated(MOST) }}
    </p>

    <UModal v-model:open="unpublishOpen" :title="m.bulk.unpublishTitle(unpublishing.length)">
      <template #body>
        <p class="text-sm">{{ m.bulk.unpublishBody }}</p>
      </template>
      <template #footer>
        <UButton :label="m.common.cancel" variant="ghost" @click="unpublishing = []" />
        <UButton
          :label="m.bulk.unpublish(unpublishing.length)"
          color="error"
          @click="unpublishMany"
        />
      </template>
    </UModal>

    <UModal v-model:open="trashOpen" :title="m.bulk.trashTitle(trashing.length)">
      <template #body>
        <p class="text-sm">{{ m.bulk.trashBody }}</p>
      </template>
      <template #footer>
        <UButton :label="m.common.keepIt" variant="ghost" @click="trashing = []" />
        <UButton :label="m.bulk.trash(trashing.length)" color="error" @click="trashMany" />
      </template>
    </UModal>

    <UModal v-model:open="scheduleOpen" :title="m.bulk.scheduleTitle(scheduling.length)">
      <template #body>
        <UFormField
          :label="m.entry.publishAt"
          :help="m.entry.publishAtHelp"
          :error="scheduleError ?? undefined"
        >
          <UInput v-model="publishAt" type="datetime-local" class="w-full" />
        </UFormField>
      </template>
      <template #footer>
        <UButton :label="m.common.cancel" variant="ghost" @click="scheduling = []" />
        <UButton
          :label="m.bulk.schedule(scheduling.length)"
          :disabled="scheduleError !== null"
          @click="publishMany(scheduling, new Date(publishAt).toISOString())"
        />
      </template>
    </UModal>

    <UModal v-model:open="warnedOpen" :title="m.bulk.acknowledgeTitle(warned.length)">
      <template #body>
        <ul class="space-y-4 text-sm">
          <li v-for="{ row, warnings } in warned" :key="row.id">
            <p class="font-medium">{{ row.title }}</p>
            <ul class="mt-1 space-y-1">
              <li v-for="(warning, index) in warnings" :key="index">
                <span class="font-mono text-xs text-muted">{{ warning.contract }}</span>
                {{ warning.message }}
              </li>
            </ul>
          </li>
        </ul>
      </template>
      <template #footer>
        <UButton :label="m.common.cancel" variant="ghost" @click="warned = []" />
        <UButton
          :label="m.entry.publishAnyway"
          color="warning"
          :loading="busy"
          @click="acceptWarnings"
        />
      </template>
    </UModal>
  </Page>
</template>
