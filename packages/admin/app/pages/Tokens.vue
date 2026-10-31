<script setup lang="ts">
import type { TableColumn } from '@nuxt/ui'
import DataTable from '../components/DataTable.vue'
import Page from '../components/Page.vue'
import { sortable } from '../lib/columns.ts'
import { useToast } from '@nuxt/ui/composables'
import { computed, onMounted, ref, watch } from 'vue'
import { useRoute } from 'vue-router'
import { ApiError } from '../lib/api.ts'
import { formatDate, useMessages } from '../i18n/index.ts'
import { runAll, countOutcomes } from '../lib/bulk.ts'
import { useBulkReport } from '../lib/bulk-report.ts'
import { api } from '../lib/session.ts'
import { scopesFor, tokenRequest } from '../lib/tokens.ts'
import type { AgentMember } from '../lib/agents.ts'
import { PERSONAL_TOKEN_TTL_DAYS } from '@hollware/core'

type Token = {
  id: string
  kind: 'personal' | 'read'
  label: string
  scopes: string[]
  user: string | null
  userKind: 'person' | 'agent' | null
  expiresAt: string | null
  revokedAt: string | null
  lastUsedAt: string | null
  createdAt: string
}

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
const route = useRoute()
const tokens = ref<Token[]>([])
const agents = ref<AgentMember[]>([])
const failure = ref<string | null>(null)
const label = ref('')
const chosen = ref<string[]>(['content:read', 'content:write'])
const days = ref<number | undefined>(undefined)
const until = ref('')
const never = ref(false)
const read = ref(false)
const member = ref(typeof route.query['member'] === 'string' ? route.query['member'] : '')
const secret = ref<string | null>(null)
const busy = ref(false)

const owners = computed(() => [
  { label: m.value.tokens.forMe, value: '' },
  ...agents.value.map((agent) => ({ label: m.value.tokens.forAgent(agent.name), value: agent.id })),
])
const scopes = computed(() => scopesFor(member.value))

watch(member, (chosenMember) => {
  if (chosenMember !== '') read.value = false
  chosen.value = chosen.value.filter((scope) => scopesFor(chosenMember).includes(scope))
})

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

async function listAgents() {
  try {
    agents.value = (await api.admin<{ agents: AgentMember[] }>('agents')).agents
  } catch {
    agents.value = []
  }
}

onMounted(() => Promise.all([list(), listAgents()]))

function toggle(scope: string, on: boolean) {
  chosen.value = on ? [...chosen.value, scope] : chosen.value.filter((s) => s !== scope)
}

async function make() {
  busy.value = true
  try {
    const made = await api.admin<{ secret: string }>(
      'tokens',
      tokenRequest({
        label: label.value,
        read: read.value,
        scopes: chosen.value,
        days: days.value,
        until: until.value,
        never: never.value,
        member: member.value,
      }),
    )
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
          <UFormField v-if="agents.length > 0" :label="m.tokens.whose">
            <USelect v-model="member" :items="owners" class="w-56" />
          </UFormField>
          <UFormField :label="m.tokens.days">
            <UInput
              v-model.number="days"
              type="number"
              :min="1"
              :max="365"
              :placeholder="read ? m.tokens.never : m.tokens.defaultDays(PERSONAL_TOKEN_TTL_DAYS)"
              :disabled="(never && !read) || until !== ''"
              class="w-40"
            />
          </UFormField>
          <UFormField :label="m.tokens.until">
            <UInput v-model="until" type="date" :disabled="never && !read" class="w-44" />
          </UFormField>
          <UCheckbox v-if="!read" v-model="never" :label="m.tokens.never" />
          <UCheckbox
            v-if="member === ''"
            v-model="read"
            :label="m.tokens.read"
            :description="m.tokens.readDescription"
          />
          <fieldset v-if="!read" class="flex flex-wrap gap-3">
            <legend class="sr-only">{{ m.tokens.scopes }}</legend>
            <UCheckbox
              v-for="scope in scopes"
              :key="scope"
              :label="scope"
              :model-value="chosen.includes(scope)"
              @update:model-value="(on) => toggle(scope, on === true)"
            />
          </fieldset>
          <p v-if="member !== ''" class="w-full text-sm text-muted">{{ m.tokens.agentNote }}</p>
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
          <template #user-cell="{ row }">
            <span>{{ row.original.user ?? '—' }}</span>
            <UBadge
              v-if="row.original.userKind === 'agent'"
              :label="m.tokens.agent"
              color="neutral"
              variant="subtle"
              size="sm"
              class="ml-2"
            />
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
