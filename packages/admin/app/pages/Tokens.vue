<script setup lang="ts">
import { useToast } from '@nuxt/ui/composables'
import { onMounted, ref } from 'vue'
import { ApiError } from '../lib/api.ts'
import { api } from '../lib/session.ts'

interface Token {
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

const toast = useToast()
const tokens = ref<Token[]>([])
const failure = ref<string | null>(null)
const label = ref('')
const chosen = ref<string[]>(['content:read', 'content:write'])
const days = ref(90)
/** A read token reads published content over the read API, and nothing else. */
const read = ref(false)
/** The secret of the token just made: shown once, never again. */
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
      expiresInDays: days.value,
    })
    secret.value = made.secret
    label.value = ''
    await list()
  } catch (error) {
    toast.add({ title: 'Not made', description: describe(error), color: 'error' })
  } finally {
    busy.value = false
  }
}

async function revoke(token: Token) {
  try {
    await api.admin(`tokens/${token.id}/revoke`, {})
    toast.add({ title: `Revoked ${token.label}`, color: 'success' })
    await list()
  } catch (error) {
    toast.add({ title: 'Not revoked', description: describe(error), color: 'error' })
  }
}

async function copy() {
  if (secret.value !== null) await navigator.clipboard.writeText(secret.value)
}

const day = (value: string | null) => (value === null ? '—' : new Date(value).toLocaleDateString())
</script>

<template>
  <div class="space-y-6">
    <h1 class="text-xl font-semibold">Tokens</h1>
    <UAlert
      v-if="failure !== null"
      color="warning"
      title="Only an owner manages tokens"
      :description="failure"
    />
    <template v-else>
      <form class="flex max-w-3xl flex-wrap items-end gap-4" @submit.prevent="make">
        <UFormField label="Label" class="min-w-56 flex-1">
          <UInput v-model="label" class="w-full" placeholder="What the token is for" required />
        </UFormField>
        <UFormField label="Days">
          <UInput v-model.number="days" type="number" :min="1" :max="365" class="w-24" />
        </UFormField>
        <UCheckbox
          v-model="read"
          label="Read token"
          description="Reads published content over the read API, and nothing else"
        />
        <fieldset v-if="!read" class="flex flex-wrap gap-3">
          <legend class="sr-only">Scopes</legend>
          <UCheckbox
            v-for="scope in SCOPES"
            :key="scope"
            :label="scope"
            :model-value="chosen.includes(scope)"
            @update:model-value="(on) => toggle(scope, on === true)"
          />
        </fieldset>
        <UButton type="submit" label="Make a token" :loading="busy" />
      </form>
      <UAlert
        v-if="secret !== null"
        color="success"
        title="Copy the token now: it is not shown again"
        :description="secret"
        :actions="[
          { label: 'Copy', onClick: copy },
          { label: 'Done', onClick: () => (secret = null) },
        ]"
      />
      <table class="w-full text-sm">
        <thead class="text-left text-muted">
          <tr>
            <th class="py-2">Label</th>
            <th>Kind</th>
            <th>Person</th>
            <th>Scopes</th>
            <th>Expires</th>
            <th>Last used</th>
            <th />
          </tr>
        </thead>
        <tbody>
          <tr v-for="token in tokens" :key="token.id" class="border-t border-default">
            <td class="py-2 font-medium">{{ token.label }}</td>
            <td>{{ token.kind }}</td>
            <td>{{ token.user ?? '—' }}</td>
            <td class="font-mono text-xs">{{ token.scopes.join(' ') }}</td>
            <td>{{ day(token.expiresAt) }}</td>
            <td>{{ day(token.lastUsedAt) }}</td>
            <td class="text-right">
              <UBadge
                v-if="token.revokedAt !== null"
                label="revoked"
                color="neutral"
                variant="subtle"
              />
              <UButton
                v-else
                label="Revoke"
                color="error"
                variant="ghost"
                size="sm"
                @click="revoke(token)"
              />
            </td>
          </tr>
        </tbody>
      </table>
    </template>
  </div>
</template>
