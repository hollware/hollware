<script setup lang="ts">
import type { TableColumn } from '@nuxt/ui'
import DataTable from '../components/DataTable.vue'
import Page from '../components/Page.vue'
import { sortable } from '../lib/columns.ts'
import { useToast } from '@nuxt/ui/composables'
import { computed, onMounted, ref } from 'vue'
import { ApiError } from '../lib/api.ts'
import { formatDate, useMessages } from '../i18n/index.ts'
import { runAll, countOutcomes } from '../lib/bulk.ts'
import { useBulkReport } from '../lib/bulk-report.ts'
import { api } from '../lib/session.ts'

type Token = {
  id: string
  kind: 'personal' | 'read'
  label: string
  scopes: string[]
  user: string | null
  expiresAt: string | null
  revokedAt: string | null
  lastUsedAt: string | null
  createdAt: string
}

const SCOPES = ['content:read', 'content:write', 'content:publish', 'schema:admin']

const m = useMessages()
const columns = computed<TableColumn<Token>[]>(() => [
  { accessorKey: 'label', header: sortable(m.value.tokens.columns.label) },
  { accessorKey: 'kind', header: sortable(m.value.tokens.columns.kind) },
  { accessorKey: 'user', header: sortable(m.value.tokens.columns.person) },
  { accessorKey: 'scopes', header: m.value.tokens.columns.scopes },
  { accessorKey: 'expiresAt', header: sortable(m.value.tokens.columns.expires) },
  { accessorKey: 'lastUsedAt', header: sortable(m.value.tokens.columns.lastUsed) },
  { id: 'actions', header: '' },
])

const toast = useToast()
const tokens = ref<Token[]>([])
const failure = ref<string | null>(null)
const label = ref('')
const chosen = ref<string[]>(['content:read', 'content:write'])
const days = ref<number | undefined>(undefined)
const read = ref(false)
const secret = ref<string | null>(null)
const busy = ref(false)

function describe(error: unknown): string {
  return error instanceof ApiError ? `${error.message} ${error.fix}` : String(error)
}

async function list() {
  try {
    tokens.value = (await api.admin<{ tokens: Token[] }>('tokens')).tokens
    failure.value = null
  } catch (error) {
    failure.value = describe(error)
  }
}

onMounted(list)

function toggle(scope: string, on: boolean) {
  chosen.value = on ? [...chosen.value, scope] : chosen.value.filter((s) => s !== scope)
}

async function make() {
  busy.value = true
  try {
    const made = await api.admin<{ secret: string }>('tokens', {
      label: label.value,
      ...(read.value ? { kind: 'read' } : { scopes: chosen.value }),
      ...(typeof days.value === 'number' && days.value > 0 ? { expiresInDays: days.value } : {}),
    })
    secret.value = made.secret
    label.value = ''
    await list()
  } catch (error) {
    toast.add({ title: m.value.tokens.notMade, description: describe(error), color: 'error' })
  } finally {
    busy.value = false
  }
}

async function revoke(token: Token) {
  try {
    await api.admin(`tokens/${token.id}/revoke`, {})
    toast.add({ title: m.value.tokens.revokedToast(token.label), color: 'success' })
    await list()
  } catch (error) {
    toast.add({ title: m.value.tokens.notRevoked, description: describe(error), color: 'error' })
  }
}

const reportBulk = useBulkReport()
const revoking = ref<Token[]>([])
const revokeOpen = computed({
  get: () => revoking.value.length > 0,
  set: (value: boolean) => {
    if (!value) revoking.value = []
  },
})
const live = (token: Token) => token.revokedAt === null

async function revokeMany() {
  const chosenTokens = revoking.value
  revoking.value = []
  const results = await runAll(chosenTokens, async (token) => {
    await api.admin(`tokens/${token.id}/revoke`, {})
    return { outcome: 'revoked' }
  })
  reportBulk(countOutcomes(results))
  await list()
}

async function copy() {
  if (secret.value !== null) await navigator.clipboard.writeText(secret.value)
}

const day = (value: string | null) => (value === null ? '—' : formatDate(value))
</script>

<template>
  <Page :title="m.tokens.title">
    <div class="space-y-6">
      <UAlert
        v-if="failure !== null"
        color="warning"
        :title="m.tokens.ownerOnly"
        :description="failure"
      />
      <template v-else>
        <form class="flex max-w-3xl flex-wrap items-end gap-4" @submit.prevent="make">
          <UFormField :label="m.tokens.label" class="min-w-56 flex-1">
            <UInput
              v-model="label"
              class="w-full"
              :placeholder="m.tokens.labelPlaceholder"
              required
            />
          </UFormField>
          <UFormField :label="m.tokens.days">
            <UInput
              v-model.number="days"
              type="number"
              :min="1"
              :max="365"
              :placeholder="m.tokens.never"
              class="w-40"
            />
          </UFormField>
          <UCheckbox
            v-model="read"
            :label="m.tokens.read"
            :description="m.tokens.readDescription"
          />
          <fieldset v-if="!read" class="flex flex-wrap gap-3">
            <legend class="sr-only">{{ m.tokens.scopes }}</legend>
            <UCheckbox
              v-for="scope in SCOPES"
              :key="scope"
              :label="scope"
              :model-value="chosen.includes(scope)"
              @update:model-value="(on) => toggle(scope, on === true)"
            />
          </fieldset>
          <UButton type="submit" :label="m.tokens.make" :loading="busy" />
        </form>
        <UAlert
          v-if="secret !== null"
          color="success"
          :title="m.tokens.copyNow"
          :description="secret"
          :actions="[
            { label: m.common.copy, onClick: copy },
            { label: m.common.done, onClick: () => (secret = null) },
          ]"
        />
        <DataTable
          :data="tokens"
          :columns="columns"
          :filter-label="m.tokens.filter"
          :empty="m.tokens.empty"
          selectable
          :row-label="(token: Token) => token.label"
        >
          <template #bulk="{ selected }">
            <UButton
              v-if="selected.some(live)"
              :label="m.bulk.revoke(selected.filter(live).length)"
              icon="i-lucide-ban"
              color="error"
              variant="outline"
              size="sm"
              @click="revoking = selected.filter(live)"
            />
          </template>
          <template #label-cell="{ row }">
            <span class="font-medium">{{ row.original.label }}</span>
          </template>
          <template #scopes-cell="{ row }">
            <span class="font-mono text-xs">{{ row.original.scopes.join(' ') }}</span>
          </template>
          <template #expiresAt-cell="{ row }">{{ day(row.original.expiresAt) }}</template>
          <template #lastUsedAt-cell="{ row }">{{ day(row.original.lastUsedAt) }}</template>
          <template #actions-cell="{ row }">
            <div class="text-right">
              <UBadge
                v-if="row.original.revokedAt !== null"
                :label="m.tokens.revoked"
                color="neutral"
                variant="subtle"
              />
              <UButton
                v-else
                :label="m.tokens.revoke"
                color="error"
                variant="ghost"
                size="sm"
                @click="revoke(row.original)"
              />
            </div>
          </template>
        </DataTable>
        <UModal v-model:open="revokeOpen" :title="m.bulk.revokeTitle(revoking.length)">
          <template #body>
            <p class="text-sm">{{ m.bulk.revokeBody }}</p>
          </template>
          <template #footer>
            <UButton :label="m.common.cancel" variant="ghost" @click="revoking = []" />
            <UButton :label="m.bulk.revoke(revoking.length)" color="error" @click="revokeMany" />
          </template>
        </UModal>
      </template>
    </div>
  </Page>
</template>
