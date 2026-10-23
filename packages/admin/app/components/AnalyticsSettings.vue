<script setup lang="ts">
import { useToast } from '@nuxt/ui/composables'
import { computed, onMounted, ref } from 'vue'
import type { AnalyticsProvider, AnalyticsSettings } from '@hollware/core'
import { ApiError, type Output } from '../lib/api.ts'
import { formatDateTime, formatNumber, useMessages } from '../i18n/index.ts'
import { api } from '../lib/session.ts'

const KEY_PAGES: Record<AnalyticsProvider, string> = {
  cloudflare: 'https://dash.cloudflare.com/profile/api-tokens',
  posthog: 'https://us.posthog.com/settings/user-api-keys',
  plausible: 'https://plausible.io/settings/api-keys',
  ga4: 'https://console.cloud.google.com/iam-admin/serviceaccounts',
}

const PROVIDERS: readonly AnalyticsProvider[] = ['cloudflare', 'posthog', 'plausible', 'ga4']

const toast = useToast()
const m = useMessages()
const status = ref<Output<'get_analytics'> | null>(null)
const editing = ref(false)
const busy = ref(false)
const provider = ref<AnalyticsProvider>('cloudflare')
const credential = ref('')
const hosts = ref('')
const accountId = ref('')
const host = ref('')
const siteId = ref('')
const propertyId = ref('')
const failure = ref<{ message: string; fix: string } | null>(null)
const result = ref<string | null>(null)

const providerItems = computed(() =>
  PROVIDERS.map((value) => ({ value, label: m.value.analytics.providers[value] })),
)
const showForm = computed(() => editing.value || status.value?.outcome === 'not_connected')
const ready = computed(
  () =>
    credential.value.trim() !== '' &&
    (provider.value !== 'ga4' || /^\d{1,20}$/.test(propertyId.value.trim())) &&
    (provider.value !== 'cloudflare' || /^[0-9a-f]{32}$/.test(accountId.value.trim())),
)

function settings(): AnalyticsSettings {
  const listed = hosts.value
    .split(',')
    .map((name) => name.trim().toLowerCase())
    .filter((name) => name !== '')
  return {
    ...(listed.length > 0 ? { hosts: listed } : {}),
    ...(provider.value === 'cloudflare' && accountId.value.trim() !== ''
      ? { accountId: accountId.value.trim() }
      : {}),
    ...((provider.value === 'posthog' || provider.value === 'plausible') && host.value.trim() !== ''
      ? { host: host.value.trim() }
      : {}),
    ...(provider.value === 'plausible' && siteId.value.trim() !== ''
      ? { siteId: siteId.value.trim() }
      : {}),
    ...(provider.value === 'ga4' ? { propertyId: propertyId.value.trim() } : {}),
  }
}

function describe(error: unknown): string {
  return error instanceof ApiError ? `${error.message} ${error.fix}` : String(error)
}

async function load() {
  status.value = await api.call('get_analytics', {})
}

async function connect() {
  busy.value = true
  failure.value = null
  result.value = null
  try {
    const answer = await api.call('connect_analytics', {
      provider: provider.value,
      credential: credential.value.trim(),
      settings: settings(),
    })
    if (answer.outcome === 'connected') {
      credential.value = ''
      editing.value = false
      result.value = m.value.analytics.connected(
        formatNumber(answer.views ?? 0),
        formatNumber(answer.paths ?? 0),
      )
      await load()
    } else if (answer.outcome === 'unavailable') {
      failure.value = { message: m.value.analytics.unavailable, fix: '' }
    } else {
      failure.value = { message: answer.message ?? '', fix: answer.fix ?? '' }
    }
  } catch (error) {
    failure.value = { message: describe(error), fix: '' }
  } finally {
    busy.value = false
  }
}

async function disconnect() {
  busy.value = true
  try {
    await api.call('disconnect_analytics', {})
    result.value = null
    toast.add({ title: m.value.analytics.disconnected, color: 'success' })
    await load()
  } catch (error) {
    toast.add({ title: m.value.analytics.failed, description: describe(error), color: 'error' })
  } finally {
    busy.value = false
  }
}

onMounted(load)
</script>

<template>
  <section aria-labelledby="analytics" class="max-w-2xl space-y-4">
    <h2 id="analytics" class="font-semibold">{{ m.analytics.title }}</h2>
    <p class="text-sm text-muted">{{ m.analytics.help }}</p>
    <p v-if="status === null" class="text-sm text-muted">{{ m.common.loading }}</p>
    <div
      v-else-if="status.outcome === 'connected' && status.provider !== undefined"
      class="flex flex-wrap items-center gap-3 rounded-lg border border-default px-4 py-3 text-sm"
    >
      <div class="min-w-0 flex-1 space-y-0.5">
        <p class="font-medium">{{ m.analytics.reading(m.analytics.providers[status.provider]) }}</p>
        <p v-if="status.connectedAt !== undefined" class="text-muted">
          {{ m.analytics.since(formatDateTime(status.connectedAt)) }}
        </p>
      </div>
      <UButton
        v-if="!editing"
        :label="m.analytics.replace"
        size="xs"
        variant="outline"
        @click="editing = true"
      />
      <UButton
        :label="m.analytics.disconnect"
        color="error"
        variant="ghost"
        size="xs"
        :loading="busy"
        @click="disconnect"
      />
    </div>
    <UAlert v-if="result !== null" color="success" :title="result" />
    <form v-if="status !== null && showForm" class="space-y-4" @submit.prevent="connect">
      <UFormField :label="m.analytics.provider">
        <USelect v-model="provider" :items="providerItems" class="w-64" />
      </UFormField>
      <p class="text-sm text-muted">
        {{ m.analytics.steps[provider] }}
        <a
          :href="KEY_PAGES[provider]"
          target="_blank"
          rel="noopener noreferrer"
          class="text-highlighted underline"
          >{{ m.analytics.open(m.analytics.providers[provider]) }}</a
        >
      </p>
      <UFormField
        :label="provider === 'ga4' ? m.analytics.credentialGa4 : m.analytics.credential"
        :help="m.analytics.credentialHelp"
      >
        <UTextarea
          v-if="provider === 'ga4'"
          v-model="credential"
          :rows="4"
          autocomplete="off"
          class="w-full font-mono"
        />
        <UInput
          v-else
          v-model="credential"
          type="password"
          autocomplete="off"
          class="w-full font-mono"
        />
      </UFormField>
      <UFormField
        v-if="provider === 'ga4'"
        :label="m.analytics.propertyId"
        :help="m.analytics.propertyIdHelp"
      >
        <UInput v-model="propertyId" inputmode="numeric" class="w-60 font-mono" />
      </UFormField>
      <UFormField
        v-if="provider === 'cloudflare'"
        :label="m.analytics.accountId"
        :help="m.analytics.accountIdHelp"
      >
        <UInput v-model="accountId" class="w-80 font-mono" />
      </UFormField>
      <UFormField
        v-if="provider === 'posthog' || provider === 'plausible'"
        :label="m.analytics.host"
        :help="m.analytics.hostHelp"
      >
        <UInput v-model="host" class="w-80" />
      </UFormField>
      <UFormField
        v-if="provider === 'plausible'"
        :label="m.analytics.siteId"
        :help="m.analytics.siteIdHelp"
      >
        <UInput v-model="siteId" class="w-80" />
      </UFormField>
      <UFormField :label="m.analytics.hosts" :help="m.analytics.hostsHelp">
        <UInput v-model="hosts" class="w-full" />
      </UFormField>
      <UAlert
        v-if="failure !== null"
        color="error"
        :title="m.analytics.failed"
        :description="`${failure.message} ${failure.fix}`.trim()"
      />
      <div class="flex gap-2">
        <UButton
          type="submit"
          color="secondary"
          :label="m.analytics.connect"
          :disabled="!ready"
          :loading="busy"
        />
        <UButton
          v-if="status.outcome === 'connected'"
          :label="m.common.cancel"
          variant="ghost"
          @click="editing = false"
        />
      </div>
    </form>
  </section>
</template>
