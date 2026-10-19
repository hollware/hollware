<script setup lang="ts">
import Page from '../components/Page.vue'
import { useToast } from '@nuxt/ui/composables'
import { computed, onMounted, ref } from 'vue'
import StructureDialogs from '../components/StructureDialogs.vue'
import { ApiError, type Output } from '../lib/api.ts'
import { formatDateTime, formatNumber, useMessages } from '../i18n/index.ts'
import { sitePreset, type Preset } from '@hollware/core'
import { api, auth } from '../lib/session.ts'
import { useStructureChange } from '../lib/structure.ts'
import { parseRetention } from '../lib/activity.ts'
import { parseWidths } from '../lib/media.ts'
import {
  AUDIT_RETENTION_MAX_DAYS,
  AUDIT_RETENTION_MIN_DAYS,
  BACKUP_RETENTION_MAX_DAYS,
  BACKUP_RETENTION_MIN_DAYS,
  MEDIA_MAX_WIDTH,
  MEDIA_MIN_WIDTH,
} from '@hollware/core'

type Structure = Output<'get_structure'>
interface Me {
  readonly site: string
  readonly sites: readonly { readonly site: string; readonly role: string }[]
  readonly trash: readonly { readonly site: string; readonly deletedAt: string }[]
}

const toast = useToast()
const m = useMessages()
const structure = ref<Structure | null>(null)
const me = ref<Me | null>(null)
const locales = ref<string[]>([])
const defaultLocale = ref('')
const url = ref('')
const origins = ref<string[]>([])
const styleGuide = ref('')
const deleteOpen = ref(false)
const deleteEntries = ref<number | null>(null)
const newKey = ref('')
const newLocales = ref<string[]>(['en'])
const newPreset = ref<Preset>('blog')
const busy = ref(false)
const ipAddresses = ref<'off' | 'hashed'>('off')
const keepForever = ref(true)
const retentionDays = ref<number | undefined>(undefined)
const retentionError = ref<string | null>(null)
const backupsOn = ref(true)
const backupsDays = ref<number | undefined>(30)
const backupsError = ref<string | null>(null)
const imageFormat = ref<'webp' | 'avif' | 'original'>('webp')
const imageQuality = ref<number | undefined>(85)
const imageMaxWidth = ref<number | undefined>(2400)
const imageWidths = ref('')
const keepOriginals = ref(true)
const imageWidthsError = ref<string | null>(null)
const hookName = ref('')
const hookUrl = ref('')
/** The secret just made for a webhook: shown this once. */
const madeSecret = ref<{ webhook: string; secret: string } | null>(null)

const webhooks = computed(() => structure.value?.definition.events.webhooks ?? [])
const validHook = computed(
  () =>
    /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(hookName.value) &&
    /^https:\/\/\S+$/.test(hookUrl.value) &&
    !webhooks.value.some((webhook) => webhook.name === hookName.value),
)

async function saveWebhooks(next: Structure['definition']['events']['webhooks']) {
  const current = structure.value
  if (current === null) return
  const definition = {
    ...current.definition,
    events: { ...current.definition.events, webhooks: next },
  }
  await change.run((confirm) =>
    api.call('update_site', { version: current.version, definition, confirm }),
  )
}

async function addWebhook() {
  const name = hookName.value
  await saveWebhooks([...webhooks.value, { name, url: hookUrl.value }])
  hookName.value = ''
  hookUrl.value = ''
  await makeSecret(name)
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

function describe(error: unknown): string {
  return error instanceof ApiError ? `${error.message} ${error.fix}` : String(error)
}

type Redirect = Output<'list_redirects'>['redirects'][number]
const redirectList = ref<Redirect[]>([])
type BackupList = Output<'list_backups'>
const backupList = ref<BackupList | null>(null)

/** A backup, fetched with the token and saved as a file. */
async function downloadBackup(date: string) {
  try {
    const blob = await api.backup(date)
    const href = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = href
    link.download = `${structure.value?.site ?? 'site'}-${date}.json`
    document.body.append(link)
    link.click()
    link.remove()
    URL.revokeObjectURL(href)
  } catch (error) {
    toast.add({ title: m.value.site.notDownloaded, description: describe(error), color: 'error' })
  }
}

async function load() {
  const [read, who, moved, backups] = await Promise.all([
    api.call('get_structure', {}),
    api.admin<Me>('me'),
    api.call('list_redirects', { limit: 500 }),
    api.call('list_backups', {}),
  ])
  redirectList.value = moved.redirects
  backupList.value = backups
  structure.value = read
  me.value = who
  locales.value = [...read.definition.locales]
  defaultLocale.value = read.definition.defaultLocale
  url.value = read.definition.url ?? ''
  origins.value = [...read.definition.cors.origins]
  styleGuide.value = read.definition.styleGuide ?? ''
  ipAddresses.value = read.definition.audit.ipAddresses
  keepForever.value = read.definition.audit.retentionDays === null
  retentionDays.value = read.definition.audit.retentionDays ?? undefined
  retentionError.value = null
  backupsOn.value = read.definition.backups.enabled
  backupsDays.value = read.definition.backups.retentionDays
  backupsError.value = null
  imageFormat.value = read.definition.media.format
  imageQuality.value = read.definition.media.quality
  imageMaxWidth.value = read.definition.media.maxWidth
  imageWidths.value = read.definition.media.widths.join(', ')
  keepOriginals.value = read.definition.media.keepOriginals
  imageWidthsError.value = null
}
onMounted(load)

const change = useStructureChange(async (answer) => {
  toast.add({
    title:
      answer.outcome === 'updated' ? m.value.common.savedApplies : m.value.common.nothingChanged,
    color: 'success',
  })
  await load()
})

async function saveSettings() {
  const current = structure.value
  if (current === null) return
  const definition = {
    ...current.definition,
    locales: [...locales.value],
    defaultLocale: defaultLocale.value,
    url: url.value.trim() === '' ? null : url.value.trim(),
    cors: { origins: [...origins.value] },
    styleGuide: styleGuide.value.trim() === '' ? null : styleGuide.value,
  }
  await change.run((confirm) =>
    api.call('update_site', { version: current.version, definition, confirm }),
  )
}

async function saveActivity() {
  const current = structure.value
  if (current === null) return
  const retention = parseRetention(keepForever.value, retentionDays.value)
  if (!retention.ok) {
    retentionError.value = m.value.site.retentionInvalid(retention.min, retention.max)
    return
  }
  retentionError.value = null
  const definition = {
    ...current.definition,
    audit: { ipAddresses: ipAddresses.value, retentionDays: retention.days },
  }
  await change.run((confirm) =>
    api.call('update_site', { version: current.version, definition, confirm }),
  )
}

async function saveBackups() {
  const current = structure.value
  if (current === null) return
  const days = backupsDays.value
  if (
    typeof days !== 'number' ||
    !Number.isInteger(days) ||
    days < BACKUP_RETENTION_MIN_DAYS ||
    days > BACKUP_RETENTION_MAX_DAYS
  ) {
    backupsError.value = m.value.site.backupsKeepInvalid(
      BACKUP_RETENTION_MIN_DAYS,
      BACKUP_RETENTION_MAX_DAYS,
    )
    return
  }
  backupsError.value = null
  const definition = {
    ...current.definition,
    backups: { enabled: backupsOn.value, retentionDays: days },
  }
  await change.run((confirm) =>
    api.call('update_site', { version: current.version, definition, confirm }),
  )
}

async function saveImages() {
  const current = structure.value
  if (current === null) return
  const widths = parseWidths(imageWidths.value)
  if (!widths.ok) {
    imageWidthsError.value = m.value.site.imageWidthsInvalid(widths.min, widths.max, widths.most)
    return
  }
  imageWidthsError.value = null
  // A quality or a width out of range is the server's to refuse, with what to change.
  const definition = {
    ...current.definition,
    media: {
      format: imageFormat.value,
      quality: imageQuality.value ?? current.definition.media.quality,
      maxWidth: imageMaxWidth.value ?? current.definition.media.maxWidth,
      widths: widths.widths,
      keepOriginals: keepOriginals.value,
    },
  }
  await change.run((confirm) =>
    api.call('update_site', { version: current.version, definition, confirm }),
  )
}

const validKey = computed(() => /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(newKey.value))

async function createSite() {
  busy.value = true
  try {
    const definition = sitePreset(newPreset.value, newLocales.value, newLocales.value[0] ?? 'en')
    const answer = await api.call('create_site', { key: newKey.value, definition })
    if (answer.outcome === 'created') {
      toast.add({
        title: m.value.site.created(newKey.value),
        description: m.value.site.ownerNow,
        color: 'success',
        actions: [
          {
            label: m.value.site.switchToIt,
            onClick: () => void auth.switchSite(newKey.value, '/admin/'),
          },
        ],
      })
      newKey.value = ''
      await load()
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

async function askDelete() {
  const site = me.value?.site
  if (site === undefined) return
  const answer = await api.call('delete_site', { key: site, confirm: false })
  deleteEntries.value = answer.entries ?? 0
  deleteOpen.value = true
}

async function deleteSite() {
  const current = me.value
  if (current === null) return
  deleteOpen.value = false
  try {
    await api.call('delete_site', { key: current.site, confirm: true })
    const other = current.sites.find((membership) => membership.site !== current.site)
    toast.add({ title: m.value.site.trashed(current.site), color: 'success' })
    // Its tokens work no more: the admin signs in to another site, or to none.
    await auth.switchSite(other?.site ?? current.site, '/admin/')
  } catch (error) {
    toast.add({ title: m.value.site.notDeleted, description: describe(error), color: 'error' })
  }
}

async function restore(site: string) {
  try {
    await api.call('restore_site', { key: site })
    toast.add({ title: m.value.site.restored(site), color: 'success' })
    await load()
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
  <Page :title="m.site.title">
    <div v-if="structure !== null && me !== null" class="space-y-10">
      <div>
        <p class="text-sm text-muted">
          <span class="font-mono">{{ me.site }}</span> ·
          {{ m.site.version(structure.version) }}
        </p>
      </div>

      <form class="max-w-2xl space-y-4" aria-labelledby="settings" @submit.prevent="saveSettings">
        <h2 id="settings" class="font-semibold">{{ m.site.settings }}</h2>
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
        <StructureDialogs
          :impact="change.impact.value"
          :problems="change.problems.value"
          :conflict="change.conflict.value"
          :failure="change.failure.value"
          @confirm="change.confirmPending"
          @cancel="change.cancel"
          @reload="load"
        />
      </form>

      <form
        class="max-w-2xl space-y-4"
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

      <form
        class="max-w-2xl space-y-4"
        aria-labelledby="images"
        novalidate
        @submit.prevent="saveImages"
      >
        <h2 id="images" class="font-semibold">{{ m.site.imagesTitle }}</h2>
        <p class="text-sm text-muted">{{ m.site.imagesNote }}</p>
        <URadioGroup
          v-model="imageFormat"
          :legend="m.site.imageFormat"
          :description="m.site.imageFormatHelp"
          :items="[
            { label: m.site.formatWebp, value: 'webp' },
            { label: m.site.formatAvif, value: 'avif' },
            { label: m.site.formatOriginal, value: 'original' },
          ]"
        />
        <UFormField :label="m.site.imageQuality" :help="m.site.imageQualityHelp">
          <UInput v-model.number="imageQuality" type="number" :min="1" :max="100" class="w-40" />
        </UFormField>
        <UFormField :label="m.site.imageMaxWidth" :help="m.site.imageMaxWidthHelp">
          <UInput
            v-model.number="imageMaxWidth"
            type="number"
            :min="MEDIA_MIN_WIDTH"
            :max="MEDIA_MAX_WIDTH"
            class="w-40"
          />
        </UFormField>
        <UFormField
          :label="m.site.imageWidths"
          :help="m.site.imageWidthsHelp"
          :error="imageWidthsError ?? undefined"
        >
          <UInput v-model="imageWidths" class="w-60" />
        </UFormField>
        <UFormField :help="m.site.keepOriginalsHelp">
          <USwitch v-model="keepOriginals" :label="m.site.keepOriginals" />
        </UFormField>
        <UButton type="submit" :label="m.site.saveImages" :loading="change.busy.value" />
      </form>

      <section aria-labelledby="webhooks" class="max-w-2xl space-y-4">
        <h2 id="webhooks" class="font-semibold">{{ m.site.webhooks }}</h2>
        <p class="text-sm text-muted">
          {{ m.site.webhooksNote }}
        </p>
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
              webhook.secret === undefined
                ? m.site.signedByHollware
                : m.site.signedBy(webhook.secret)
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
      </section>

      <section aria-labelledby="backups" class="max-w-2xl space-y-4">
        <h2 id="backups" class="font-semibold">{{ m.site.backupsTitle }}</h2>
        <p class="text-sm text-muted">{{ m.site.backupsHelp }}</p>
        <form
          v-if="backupList?.outcome !== 'unavailable'"
          class="space-y-4"
          novalidate
          @submit.prevent="saveBackups"
        >
          <USwitch v-model="backupsOn" :label="m.site.backupsOn" />
          <UFormField
            v-if="backupsOn"
            :label="m.site.backupsKeep"
            :help="m.site.backupsKeepHelp"
            :error="backupsError ?? undefined"
          >
            <UInput
              v-model.number="backupsDays"
              type="number"
              :min="BACKUP_RETENTION_MIN_DAYS"
              :max="BACKUP_RETENTION_MAX_DAYS"
              class="w-40"
            />
          </UFormField>
          <UButton type="submit" :label="m.site.saveBackups" :loading="change.busy.value" />
        </form>
        <p v-if="backupList?.outcome === 'unavailable'" class="text-sm text-muted">
          {{ m.site.backupsUnavailable }}
        </p>
        <p v-else-if="(backupList?.backups ?? []).length === 0" class="text-sm text-muted">
          {{ m.site.noBackups }}
        </p>
        <ul v-else class="divide-y divide-default rounded-lg border border-default text-sm">
          <li
            v-for="backup in backupList?.backups ?? []"
            :key="backup.date"
            class="flex items-center justify-between gap-2 px-3 py-2"
          >
            <span class="font-mono tabular-nums">{{ backup.date }}</span>
            <span class="text-muted tabular-nums">{{
              m.site.kilobytes(formatNumber(Math.ceil(backup.bytes / 1024)))
            }}</span>
            <UButton
              :label="m.site.download"
              :aria-label="m.site.downloadOne(backup.date)"
              icon="i-lucide-download"
              size="xs"
              variant="ghost"
              @click="downloadBackup(backup.date)"
            />
          </li>
        </ul>
      </section>

      <section aria-labelledby="redirects" class="max-w-2xl space-y-4">
        <h2 id="redirects" class="font-semibold">{{ m.site.redirectsTitle }}</h2>
        <p class="text-sm text-muted">{{ m.site.redirectsHelp }}</p>
        <p v-if="redirectList.length === 0" class="text-sm text-muted">{{ m.site.noRedirects }}</p>
        <ul v-else class="divide-y divide-default rounded-lg border border-default text-sm">
          <li
            v-for="redirect in redirectList"
            :key="`${redirect.collection}/${redirect.locale}/${redirect.from}`"
            class="flex flex-wrap items-center gap-2 px-3 py-2 font-mono"
          >
            <span>{{ redirect.fromPath ?? redirect.from }}</span>
            <UIcon name="i-lucide-arrow-right" class="text-muted" aria-hidden="true" />
            <span>{{ redirect.toPath ?? redirect.to }}</span>
          </li>
        </ul>
      </section>

      <section aria-labelledby="sites" class="max-w-2xl space-y-4">
        <h2 id="sites" class="font-semibold">{{ m.site.yourSites }}</h2>
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

      <section
        aria-labelledby="danger"
        class="max-w-2xl space-y-3 rounded-lg border border-error/40 p-4"
      >
        <h2 id="danger" class="font-semibold">{{ m.site.dangerTitle }}</h2>
        <p class="text-sm text-muted">
          {{ m.site.dangerBody }}
        </p>
        <UButton :label="m.site.trashIt" color="error" variant="outline" @click="askDelete" />
      </section>

      <UModal v-model:open="deleteOpen" :title="m.site.trashTitle(me.site)">
        <template #body>
          <p>{{ m.site.trashBody(deleteEntries ?? 0) }}</p>
        </template>
        <template #footer>
          <UButton :label="m.common.keepIt" variant="ghost" @click="deleteOpen = false" />
          <UButton :label="m.site.trashIt" color="error" @click="deleteSite" />
        </template>
      </UModal>
    </div>
    <p v-else class="text-muted">{{ m.common.loading }}</p>
  </Page>
</template>
