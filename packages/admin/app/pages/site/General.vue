<script setup lang="ts">
import Page from '../../components/Page.vue'
import { useToast } from '@nuxt/ui/composables'
import { computed, onMounted, ref } from 'vue'
import StructureDialogs from '../../components/StructureDialogs.vue'
import { ApiError } from '../../lib/api.ts'
import { formatDateTime, useMessages } from '../../i18n/index.ts'
import { sitePreset, type Preset } from '@hollware/core'
import { AUDIT_RETENTION_MAX_DAYS, AUDIT_RETENTION_MIN_DAYS } from '@hollware/core'
import { api, auth } from '../../lib/session.ts'
import { parseRetention } from '../../lib/activity.ts'
import { useSiteSettings } from '../../lib/site-settings.ts'

interface Me {
  readonly site: string
  readonly sites: readonly { readonly site: string; readonly role: string }[]
  readonly trash: readonly { readonly site: string; readonly deletedAt: string }[]
}

const toast = useToast()
const m = useMessages()
const me = ref<Me | null>(null)
const locales = ref<string[]>([])
const defaultLocale = ref('')
const url = ref('')
const origins = ref<string[]>([])
const styleGuide = ref('')
const ipAddresses = ref<'off' | 'hashed'>('off')
const keepForever = ref(true)
const retentionDays = ref<number | undefined>(undefined)
const retentionError = ref<string | null>(null)
const newKey = ref('')
const newLocales = ref<string[]>(['en'])
const newPreset = ref<Preset>('blog')
const busy = ref(false)

const { structure, change, load, save } = useSiteSettings((read) => {
  locales.value = [...read.definition.locales]
  defaultLocale.value = read.definition.defaultLocale
  url.value = read.definition.url ?? ''
  origins.value = [...read.definition.cors.origins]
  styleGuide.value = read.definition.styleGuide ?? ''
  ipAddresses.value = read.definition.audit.ipAddresses
  keepForever.value = read.definition.audit.retentionDays === null
  retentionDays.value = read.definition.audit.retentionDays ?? undefined
  retentionError.value = null
})

async function loadMe() {
  me.value = await api.admin<Me>('me')
}
onMounted(loadMe)

async function saveSettings() {
  await save((definition) => ({
    ...definition,
    locales: [...locales.value],
    defaultLocale: defaultLocale.value,
    url: url.value.trim() === '' ? null : url.value.trim(),
    cors: { origins: [...origins.value] },
    styleGuide: styleGuide.value.trim() === '' ? null : styleGuide.value,
  }))
}

async function saveActivity() {
  const retention = parseRetention(keepForever.value, retentionDays.value)
  if (!retention.ok) {
    retentionError.value = m.value.site.retentionInvalid(retention.min, retention.max)
    return
  }
  retentionError.value = null
  await save((definition) => ({
    ...definition,
    audit: { ipAddresses: ipAddresses.value, retentionDays: retention.days },
  }))
}

const validKey = computed(() => /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(newKey.value))

function describe(error: unknown): string {
  return error instanceof ApiError ? `${error.message} ${error.fix}` : String(error)
}

async function createSite() {
  busy.value = true
  try {
    const definition = sitePreset(newPreset.value, newLocales.value, newLocales.value[0] ?? 'en')
    const answer = await api.call('create_site', { key: newKey.value, definition })
    if (answer.outcome === 'created') {
      const key = newKey.value
      toast.add({
        title: m.value.site.created(key),
        description: m.value.site.ownerNow,
        color: 'success',
        actions: [
          {
            label: m.value.site.switchToIt,
            onClick: () => void auth.switchSite(key, '/admin/'),
          },
        ],
      })
      newKey.value = ''
      await loadMe()
    } else {
      toast.add({
        title: m.value.common.notCreated,
        description:
          answer.outcome === 'taken'
            ? m.value.site.keyTaken
            : (answer.problems ?? []).map((p) => `${p.message}. ${p.fix}`).join(' '),
        color: 'error',
      })
    }
  } catch (error) {
    toast.add({ title: m.value.common.notCreated, description: describe(error), color: 'error' })
  } finally {
    busy.value = false
  }
}

async function restore(site: string) {
  try {
    await api.call('restore_site', { key: site })
    toast.add({ title: m.value.site.restored(site), color: 'success' })
    await loadMe()
  } catch (error) {
    toast.add({ title: m.value.site.notRestored, description: describe(error), color: 'error' })
  }
}
const PRESETS = computed(() => [
  { label: m.value.site.presets.blog, value: 'blog' },
  { label: m.value.site.presets.docs, value: 'docs' },
  { label: m.value.site.presets.empty, value: 'empty' },
])
</script>

<template>
  <Page
    :title="m.settings.sections.general"
    :description="
      structure === null || me === null
        ? undefined
        : `${me.site} · ${m.site.version(structure.version)}`
    "
  >
    <div v-if="structure !== null && me !== null" class="max-w-2xl space-y-10">
      <StructureDialogs
        :impact="change.impact.value"
        :problems="change.problems.value"
        :conflict="change.conflict.value"
        :failure="change.failure.value"
        @confirm="change.confirmPending"
        @cancel="change.cancel"
        @reload="load"
      />

      <form class="space-y-4" :aria-label="m.site.settings" @submit.prevent="saveSettings">
        <UFormField :label="m.site.locales" :help="m.site.localesHelp">
          <UInputTags v-model="locales" class="w-full" />
        </UFormField>
        <UFormField :label="m.site.defaultLocale">
          <USelect v-model="defaultLocale" :items="locales" class="w-full" />
        </UFormField>
        <UFormField :label="m.site.publicUrl" :help="m.site.publicUrlHelp">
          <UInput v-model="url" class="w-full" :placeholder="m.site.urlPlaceholder" />
        </UFormField>
        <UFormField :label="m.site.origins" :help="m.site.originsHelp">
          <UInputTags v-model="origins" class="w-full" />
        </UFormField>
        <UFormField :label="m.site.styleGuide" :help="m.site.styleGuideHelp">
          <UTextarea v-model="styleGuide" :rows="4" autoresize class="w-full" />
        </UFormField>
        <UButton type="submit" :label="m.site.saveSettings" :loading="change.busy.value" />
      </form>

      <form
        class="space-y-4"
        aria-labelledby="activity-log"
        novalidate
        @submit.prevent="saveActivity"
      >
        <h2 id="activity-log" class="font-semibold">{{ m.site.activityTitle }}</h2>
        <p class="text-sm text-muted">{{ m.site.activityNote }}</p>
        <URadioGroup
          v-model="ipAddresses"
          :legend="m.site.ipAddresses"
          :description="m.site.ipHelp"
          :items="[
            { label: m.site.ipOff, value: 'off' },
            { label: m.site.ipHashed, value: 'hashed' },
          ]"
        />
        <URadioGroup
          :model-value="keepForever ? 'forever' : 'days'"
          :legend="m.site.retention"
          :description="m.site.retentionHelp"
          :items="[
            { label: m.site.retentionForever, value: 'forever' },
            { label: m.site.retentionDays, value: 'days' },
          ]"
          @update:model-value="(value) => (keepForever = value === 'forever')"
        />
        <UFormField v-if="!keepForever" :label="m.site.days" :error="retentionError ?? undefined">
          <UInput
            v-model.number="retentionDays"
            type="number"
            :min="AUDIT_RETENTION_MIN_DAYS"
            :max="AUDIT_RETENTION_MAX_DAYS"
            class="w-40"
          />
        </UFormField>
        <UButton type="submit" :label="m.site.saveActivity" :loading="change.busy.value" />
      </form>

      <section id="sites" aria-labelledby="sites-title" class="space-y-4">
        <h2 id="sites-title" class="font-semibold">{{ m.site.yourSites }}</h2>
        <ul class="divide-y divide-default rounded-lg border border-default text-sm">
          <li
            v-for="membership in me.sites"
            :key="membership.site"
            class="flex items-center gap-3 px-4 py-2.5"
          >
            <span class="font-mono">{{ membership.site }}</span>
            <span class="text-muted">{{ m.roles[membership.role] ?? membership.role }}</span>
            <span v-if="membership.site === me.site" class="ml-auto text-xs text-muted">{{
              m.site.thisOne
            }}</span>
            <UButton
              v-else
              class="ml-auto"
              :label="m.site.switch"
              size="xs"
              variant="outline"
              @click="auth.switchSite(membership.site, '/admin/')"
            />
          </li>
        </ul>
        <form
          class="grid gap-3 rounded-lg border border-default p-4 sm:grid-cols-2"
          @submit.prevent="createSite"
        >
          <h3 class="text-sm font-semibold sm:col-span-2">{{ m.site.newSite }}</h3>
          <UFormField :label="m.site.key" :help="m.site.keyHelp">
            <UInput v-model="newKey" class="w-full font-mono" />
          </UFormField>
          <UFormField :label="m.common.startFrom">
            <USelect v-model="newPreset" :items="PRESETS" class="w-full" />
          </UFormField>
          <UFormField :label="m.site.locales" :help="m.site.newLocalesHelp" class="sm:col-span-2">
            <UInputTags v-model="newLocales" class="w-full" />
          </UFormField>
          <div class="sm:col-span-2">
            <UButton
              type="submit"
              :label="m.site.createSite"
              :disabled="!validKey || newLocales.length === 0"
              :loading="busy"
            />
          </div>
        </form>
        <div v-if="me.trash.length > 0" class="space-y-2">
          <h3 class="text-sm font-semibold">{{ m.site.inTrash }}</h3>
          <ul class="divide-y divide-default rounded-lg border border-default text-sm">
            <li
              v-for="item in me.trash"
              :key="item.site"
              class="flex items-center gap-3 px-4 py-2.5"
            >
              <span class="font-mono">{{ item.site }}</span>
              <span class="text-muted">{{ m.site.since(formatDateTime(item.deletedAt)) }}</span>
              <UButton
                class="ml-auto"
                :label="m.site.restore"
                size="xs"
                variant="outline"
                @click="restore(item.site)"
              />
            </li>
          </ul>
        </div>
      </section>
    </div>
    <p v-else class="text-muted">{{ m.common.loading }}</p>
  </Page>
</template>
