<script setup lang="ts">
import type { TableColumn } from '@nuxt/ui'
import { AUDIT_ACTIONS } from '@hollware/core'
import { useToast } from '@nuxt/ui/composables'
import { computed, onMounted, ref, watch } from 'vue'
import DataTable from '../components/DataTable.vue'
import Page from '../components/Page.vue'
import { formatDateTime, useMessages } from '../i18n/index.ts'
import {
  activityQuery,
  targetLabel,
  whoOf,
  type ActivityLine,
  type ActivityPage,
} from '../lib/activity.ts'
import { ApiError } from '../lib/api.ts'
import { api } from '../lib/session.ts'

type Row = ActivityLine & Record<string, unknown>

const ALL = 'all'
const PAGE = 50

const m = useMessages()
const toast = useToast()
const columns = computed<TableColumn<Row>[]>(() => [
  { accessorKey: 'at', header: m.value.activity.columns.when },
  { id: 'who', header: m.value.activity.columns.who },
  { id: 'action', header: m.value.activity.columns.action },
  { id: 'target', header: m.value.activity.columns.target },
  { id: 'outcome', header: m.value.activity.columns.outcome },
  { id: 'detail', header: '' },
])

const lines = ref<Row[]>([])
const nextCursor = ref<string | null>(null)
const loading = ref(false)
const failure = ref<string | null>(null)
const people = ref<{ id: string; name: string | null }[]>([])
const actor = ref(ALL)
const action = ref(ALL)
const from = ref('')
const to = ref('')
const open = ref<Row | null>(null)
const exporting = ref(false)

const detailOpen = computed({
  get: () => open.value !== null,
  set: (value: boolean) => {
    if (!value) open.value = null
  },
})

const filters = computed(() => ({
  ...(actor.value === ALL ? {} : { actor: actor.value }),
  ...(action.value === ALL ? {} : { action: action.value }),
  from: from.value,
  to: to.value,
}))
const filtered = computed(
  () => actor.value !== ALL || action.value !== ALL || from.value !== '' || to.value !== '',
)

const actionItems = computed(() => [
  { label: m.value.activity.anyAction, value: ALL },
  ...AUDIT_ACTIONS.map((value) => ({ label: m.value.activity.actions[value], value })),
])
const actorItems = computed(() => [
  { label: m.value.activity.anyPerson, value: ALL },
  ...people.value.map((person) => ({ label: person.name ?? person.id, value: person.id })),
])

function describe(error: unknown): string {
  return error instanceof ApiError ? `${error.message} ${error.fix}` : String(error)
}

async function load(more: boolean) {
  loading.value = true
  try {
    const query = activityQuery(filters.value, {
      limit: PAGE,
      cursor: more ? nextCursor.value : null,
    })
    const page = await api.admin<ActivityPage>(`activity?${query}`)
    lines.value = more ? [...lines.value, ...(page.lines as Row[])] : (page.lines as Row[])
    nextCursor.value = page.nextCursor
    failure.value = null
  } catch (error) {
    failure.value = describe(error)
  } finally {
    loading.value = false
  }
}

onMounted(async () => {
  await load(false)
  try {
    people.value = (
      await api.admin<{ people: { id: string; name: string | null }[] }>('people')
    ).people
  } catch {}
})
watch(filters, () => void load(false))

function clearFilters() {
  actor.value = ALL
  action.value = ALL
  from.value = ''
  to.value = ''
}

async function exportCsv() {
  exporting.value = true
  try {
    const blob = await api.file(`activity.csv?${activityQuery(filters.value)}`)
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = 'activity.csv'
    document.body.append(link)
    link.click()
    link.remove()
    URL.revokeObjectURL(url)
  } catch (error) {
    toast.add({
      title: m.value.activity.notExported,
      description: describe(error),
      color: 'error',
    })
  } finally {
    exporting.value = false
  }
}

const kindColor = {
  user: 'primary',
  token: 'info',
  oauth_client: 'secondary',
  system: 'neutral',
} as const
const outcomeColor = { ok: 'success', denied: 'warning', failed: 'error' } as const
const actionLabel = (name: string) =>
  (m.value.activity.actions as Record<string, string>)[name] ?? name
const json = (value: unknown) => JSON.stringify(value, null, 2)
</script>

<template>
  <Page :title="m.activity.title" :description="m.activity.intro">
    <template #actions>
      <UButton
        :label="m.activity.exportCsv"
        icon="i-lucide-download"
        color="neutral"
        variant="outline"
        size="sm"
        :loading="exporting"
        :disabled="failure !== null"
        @click="exportCsv"
      />
    </template>
    <div class="space-y-4">
      <UAlert
        v-if="failure !== null"
        color="warning"
        :title="m.activity.ownerOnly"
        :description="failure"
      />
      <template v-else>
        <div class="flex flex-wrap items-end gap-3">
          <USelect
            v-model="action"
            :items="actionItems"
            :aria-label="m.activity.filterAction"
            class="w-64"
          />
          <USelect
            v-if="people.length > 0"
            v-model="actor"
            :items="actorItems"
            :aria-label="m.activity.filterActor"
            class="w-48"
          />
          <UFormField :label="m.activity.from">
            <UInput v-model="from" type="date" :max="to || undefined" class="w-40" />
          </UFormField>
          <UFormField :label="m.activity.to">
            <UInput v-model="to" type="date" :min="from || undefined" class="w-40" />
          </UFormField>
          <UButton
            v-if="filtered"
            :label="m.activity.clearFilters"
            icon="i-lucide-x"
            color="neutral"
            variant="ghost"
            size="sm"
            @click="clearFilters"
          />
        </div>
        <DataTable
          :data="lines"
          :columns="columns"
          :filter-label="m.activity.filter"
          :empty="m.activity.empty"
          :loading="loading"
          :page-size="1000"
        >
          <template #at-cell="{ row }">
            <span class="whitespace-nowrap">{{ formatDateTime(row.original.at) }}</span>
          </template>
          <template #who-cell="{ row }">
            <div class="flex flex-wrap items-center gap-2">
              <UBadge
                :label="m.activity.kinds[whoOf(row.original, m.people.formerPerson).kind]"
                :color="kindColor[whoOf(row.original, m.people.formerPerson).kind]"
                variant="subtle"
              />
              <span class="font-medium">{{
                whoOf(row.original, m.people.formerPerson).name ?? m.activity.system
              }}</span>
              <span
                v-if="whoOf(row.original, m.people.formerPerson).via !== null"
                class="text-xs text-muted"
                :title="m.activity.viaHelp"
              >
                {{ m.activity.via(whoOf(row.original, m.people.formerPerson).via ?? '') }}
              </span>
            </div>
          </template>
          <template #action-cell="{ row }">
            {{ actionLabel(row.original.action) }}
          </template>
          <template #target-cell="{ row }">
            <span class="font-mono text-xs">{{ targetLabel(row.original.target) }}</span>
          </template>
          <template #outcome-cell="{ row }">
            <UBadge
              :label="
                row.original.errorCode === null
                  ? m.activity.outcomes[row.original.outcome]
                  : `${m.activity.outcomes[row.original.outcome]}: ${row.original.errorCode}`
              "
              :color="outcomeColor[row.original.outcome]"
              variant="subtle"
            />
          </template>
          <template #detail-cell="{ row }">
            <div class="text-right">
              <UButton
                icon="i-lucide-chevron-right"
                color="neutral"
                variant="ghost"
                size="xs"
                :aria-label="m.activity.showDetail(row.original.action)"
                @click="open = row.original"
              />
            </div>
          </template>
        </DataTable>
        <div v-if="nextCursor !== null" class="flex justify-center">
          <UButton
            :label="m.activity.loadMore"
            color="neutral"
            variant="outline"
            :loading="loading"
            @click="load(true)"
          />
        </div>
      </template>
      <UModal v-model:open="detailOpen" :title="open === null ? '' : actionLabel(open.action)">
        <template #body>
          <dl v-if="open !== null" class="space-y-3 text-sm">
            <div>
              <dt class="font-semibold">{{ m.activity.detail }}</dt>
              <dd>
                <pre class="overflow-x-auto font-mono text-xs">{{
                  open.detail === null ? m.activity.none : json(open.detail)
                }}</pre>
              </dd>
            </div>
            <div>
              <dt class="font-semibold">{{ m.activity.requestId }}</dt>
              <dd class="font-mono text-xs">{{ open.requestId ?? m.activity.none }}</dd>
            </div>
            <div>
              <dt class="font-semibold">{{ m.activity.ipHash }}</dt>
              <dd class="font-mono text-xs break-all">{{ open.ipHash ?? m.activity.none }}</dd>
            </div>
            <div>
              <dt class="font-semibold">{{ m.activity.declared }}</dt>
              <dd>
                <pre class="overflow-x-auto font-mono text-xs">{{
                  open.actor.declared === null ? m.activity.none : json(open.actor.declared)
                }}</pre>
              </dd>
            </div>
          </dl>
        </template>
      </UModal>
    </div>
  </Page>
</template>
