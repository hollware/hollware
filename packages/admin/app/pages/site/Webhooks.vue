<script setup lang="ts">
import Page from '../../components/Page.vue'
import { useToast } from '@nuxt/ui/composables'
import { computed, ref } from 'vue'
import StructureDialogs from '../../components/StructureDialogs.vue'
import { ApiError } from '../../lib/api.ts'
import { useMessages } from '../../i18n/index.ts'
import { api } from '../../lib/session.ts'
import { useSiteSettings, type Definition } from '../../lib/site-settings.ts'

const toast = useToast()
const m = useMessages()
const hookName = ref('')
const hookUrl = ref('')
const madeSecret = ref<{ webhook: string; secret: string } | null>(null)

const { structure, change, load, save } = useSiteSettings()

const webhooks = computed(() => structure.value?.definition.events.webhooks ?? [])
const validHook = computed(
  () =>
    /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(hookName.value) &&
    /^https:\/\/\S+$/.test(hookUrl.value) &&
    !webhooks.value.some((webhook) => webhook.name === hookName.value),
)

async function saveWebhooks(next: Definition['events']['webhooks']) {
  await save((definition) => ({
    ...definition,
    events: { ...definition.events, webhooks: next },
  }))
}

async function addWebhook() {
  const name = hookName.value
  await saveWebhooks([...webhooks.value, { name, url: hookUrl.value }])
  hookName.value = ''
  hookUrl.value = ''
  await makeSecret(name)
}

function describe(error: unknown): string {
  return error instanceof ApiError ? `${error.message} ${error.fix}` : String(error)
}

async function makeSecret(webhook: string) {
  try {
    const answer = await api.call('make_webhook_secret', { webhook })
    if (answer.outcome === 'made' && answer.secret !== undefined) {
      madeSecret.value = { webhook, secret: answer.secret }
    } else {
      toast.add({
        title: m.value.site.noSecret,
        description:
          answer.outcome === 'unavailable' ? m.value.site.noSealSecret : m.value.site.ownSecret,
        color: 'warning',
      })
    }
  } catch (error) {
    toast.add({ title: m.value.site.noSecret, description: describe(error), color: 'error' })
  }
}

async function copySecret() {
  if (madeSecret.value !== null) await navigator.clipboard.writeText(madeSecret.value.secret)
}
</script>

<template>
  <Page :title="m.settings.sections.webhooks" :description="m.site.webhooksNote">
    <div v-if="structure !== null" class="max-w-2xl space-y-4">
      <StructureDialogs
        :impact="change.impact.value"
        :problems="change.problems.value"
        :conflict="change.conflict.value"
        :failure="change.failure.value"
        @confirm="change.confirmPending"
        @cancel="change.cancel"
        @reload="load"
      />
      <ul
        v-if="webhooks.length > 0"
        class="divide-y divide-default rounded-lg border border-default text-sm"
      >
        <li
          v-for="webhook in webhooks"
          :key="webhook.name"
          class="flex flex-wrap items-center gap-3 px-4 py-2.5"
        >
          <span class="font-mono">{{ webhook.name }}</span>
          <span class="min-w-0 flex-1 truncate text-muted">{{ webhook.url }}</span>
          <span class="text-xs text-muted">{{
            webhook.secret === undefined ? m.site.signedByHollware : m.site.signedBy(webhook.secret)
          }}</span>
          <UButton
            v-if="webhook.secret === undefined"
            :label="m.site.newSecret"
            size="xs"
            variant="outline"
            @click="makeSecret(webhook.name)"
          />
          <UButton
            icon="i-lucide-trash-2"
            color="error"
            variant="ghost"
            size="xs"
            :aria-label="m.site.removeWebhook(webhook.name)"
            @click="saveWebhooks(webhooks.filter((other) => other.name !== webhook.name))"
          />
        </li>
      </ul>
      <UAlert
        v-if="madeSecret !== null"
        color="success"
        :title="m.site.secretShown(madeSecret.webhook)"
        :description="madeSecret.secret"
        :actions="[
          { label: m.common.copy, onClick: copySecret },
          { label: m.common.done, onClick: () => (madeSecret = null) },
        ]"
      />
      <form
        class="grid gap-3 sm:grid-cols-[10rem_minmax(0,1fr)_auto] sm:items-end"
        @submit.prevent="addWebhook"
      >
        <UFormField :label="m.common.name">
          <UInput
            v-model="hookName"
            class="w-full font-mono"
            :placeholder="m.site.hookPlaceholder"
          />
        </UFormField>
        <UFormField :label="m.site.url">
          <UInput v-model="hookUrl" class="w-full" :placeholder="m.site.hookUrlPlaceholder" />
        </UFormField>
        <UButton
          type="submit"
          :label="m.site.add"
          :disabled="!validHook"
          :loading="change.busy.value"
        />
      </form>
    </div>
    <p v-else class="text-muted">{{ m.common.loading }}</p>
  </Page>
</template>
