<script setup lang="ts">
import { useToast } from '@nuxt/ui/composables'
import { computed, onMounted, ref } from 'vue'
import StructureDialogs from '../components/StructureDialogs.vue'
import { ApiError, type Output } from '../lib/api.ts'
import { when } from '../lib/entries.ts'
import { sitePreset, type Preset } from '@hollware/core'
import { api, auth } from '../lib/session.ts'
import { useStructureChange } from '../lib/structure.ts'

type Structure = Output<'get_structure'>
interface Me {
  readonly site: string
  readonly sites: readonly { readonly site: string; readonly role: string }[]
  readonly trash: readonly { readonly site: string; readonly deletedAt: string }[]
}

const toast = useToast()
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
        title: 'No secret made',
        description:
          answer.outcome === 'unavailable'
            ? 'This deployment has no HOLLWARE_SECRET to seal it with: hollware deploy makes one.'
            : 'That webhook is signed by a Worker secret of its own.',
        color: 'warning',
      })
    }
  } catch (error) {
    toast.add({ title: 'No secret made', description: describe(error), color: 'error' })
  }
}

async function copySecret() {
  if (madeSecret.value !== null) await navigator.clipboard.writeText(madeSecret.value.secret)
}

function describe(error: unknown): string {
  return error instanceof ApiError ? `${error.message} ${error.fix}` : String(error)
}

async function load() {
  const [read, who] = await Promise.all([api.call('get_structure', {}), api.admin<Me>('me')])
  structure.value = read
  me.value = who
  locales.value = [...read.definition.locales]
  defaultLocale.value = read.definition.defaultLocale
  url.value = read.definition.url ?? ''
  origins.value = [...read.definition.cors.origins]
  styleGuide.value = read.definition.styleGuide ?? ''
}
onMounted(load)

const change = useStructureChange(async (answer) => {
  toast.add({
    title: answer.outcome === 'updated' ? 'Saved: it applies at once' : 'Nothing changed',
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

const validKey = computed(() => /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(newKey.value))

async function createSite() {
  busy.value = true
  try {
    const definition = sitePreset(newPreset.value, newLocales.value, newLocales.value[0] ?? 'en')
    const answer = await api.call('create_site', { key: newKey.value, definition })
    if (answer.outcome === 'created') {
      toast.add({
        title: `The site ${newKey.value} is there`,
        description: 'You are its owner. Switch to it to fill it.',
        color: 'success',
        actions: [
          { label: 'Switch to it', onClick: () => void auth.switchSite(newKey.value, '/admin/') },
        ],
      })
      newKey.value = ''
      await load()
    } else {
      toast.add({
        title: 'Not created',
        description:
          answer.outcome === 'taken'
            ? 'A site, or one in the trash, has that key.'
            : (answer.problems ?? []).map((p) => `${p.message}. ${p.fix}`).join(' '),
        color: 'error',
      })
    }
  } catch (error) {
    toast.add({ title: 'Not created', description: describe(error), color: 'error' })
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
    toast.add({ title: `The site ${current.site} is in the trash`, color: 'success' })
    // Its tokens work no more: the admin signs in to another site, or to none.
    await auth.switchSite(other?.site ?? current.site, '/admin/')
  } catch (error) {
    toast.add({ title: 'Not deleted', description: describe(error), color: 'error' })
  }
}

async function restore(site: string) {
  try {
    await api.call('restore_site', { key: site })
    toast.add({ title: `The site ${site} is back`, color: 'success' })
    await load()
  } catch (error) {
    toast.add({ title: 'Not restored', description: describe(error), color: 'error' })
  }
}

const PRESETS = [
  { label: 'A blog', value: 'blog' },
  { label: 'Docs', value: 'docs' },
  { label: 'Pages with a title alone', value: 'empty' },
]
</script>

<template>
  <div v-if="structure !== null && me !== null" class="space-y-10">
    <div>
      <h1 class="text-xl font-semibold">Site</h1>
      <p class="text-sm text-muted">
        <span class="font-mono">{{ me.site }}</span> · version {{ structure.version }} of its
        structure. A change applies at once; nothing is deployed.
      </p>
    </div>

    <form class="max-w-2xl space-y-4" aria-labelledby="settings" @submit.prevent="saveSettings">
      <h2 id="settings" class="font-semibold">Settings</h2>
      <UFormField
        label="Locales"
        help="Such as en or es-CL. Removing one keeps its entries, out of reach."
      >
        <UInputTags v-model="locales" class="w-full" />
      </UFormField>
      <UFormField label="Default locale">
        <USelect v-model="defaultLocale" :items="locales" class="w-full" />
      </UFormField>
      <UFormField
        label="Public URL"
        help="The origin of the site, such as https://example.com: links to entries start with it."
      >
        <UInput v-model="url" class="w-full" placeholder="https://example.com" />
      </UFormField>
      <UFormField
        label="Origins that read from the browser"
        help="Pages of these origins may read published content with a read token."
      >
        <UInputTags v-model="origins" class="w-full" />
      </UFormField>
      <UFormField
        label="Style guide of the site"
        help="Markdown, for whoever writes anywhere in the site."
      >
        <UTextarea v-model="styleGuide" :rows="4" autoresize class="w-full" />
      </UFormField>
      <UButton type="submit" label="Save the settings" :loading="change.busy.value" />
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

    <section aria-labelledby="webhooks" class="max-w-2xl space-y-4">
      <h2 id="webhooks" class="font-semibold">Webhooks</h2>
      <p class="text-sm text-muted">
        Every publish, update and unpublish is sent, signed, to each of them: a site that keeps its
        pages in a cache purges them, a newsletter drafts an issue.
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
              ? "signed by Hollware's secret"
              : `signed by ${webhook.secret}`
          }}</span>
          <UButton
            v-if="webhook.secret === undefined"
            label="New secret"
            size="xs"
            variant="outline"
            @click="makeSecret(webhook.name)"
          />
          <UButton
            icon="i-lucide-trash-2"
            color="error"
            variant="ghost"
            size="xs"
            :aria-label="`Remove the webhook ${webhook.name}`"
            @click="saveWebhooks(webhooks.filter((other) => other.name !== webhook.name))"
          />
        </li>
      </ul>
      <UAlert
        v-if="madeSecret !== null"
        color="success"
        :title="`The secret of ${madeSecret.webhook}: give it to the receiver now, it is shown once`"
        :description="madeSecret.secret"
        :actions="[
          { label: 'Copy', onClick: copySecret },
          { label: 'Done', onClick: () => (madeSecret = null) },
        ]"
      />
      <form
        class="grid gap-3 sm:grid-cols-[10rem_minmax(0,1fr)_auto] sm:items-end"
        @submit.prevent="addWebhook"
      >
        <UFormField label="Name">
          <UInput v-model="hookName" class="w-full font-mono" placeholder="site" />
        </UFormField>
        <UFormField label="URL">
          <UInput
            v-model="hookUrl"
            class="w-full"
            placeholder="https://example.com/_hollware/webhook"
          />
        </UFormField>
        <UButton type="submit" label="Add" :disabled="!validHook" :loading="change.busy.value" />
      </form>
    </section>

    <section aria-labelledby="sites" class="max-w-2xl space-y-4">
      <h2 id="sites" class="font-semibold">Your sites</h2>
      <ul class="divide-y divide-default rounded-lg border border-default text-sm">
        <li
          v-for="membership in me.sites"
          :key="membership.site"
          class="flex items-center gap-3 px-4 py-2.5"
        >
          <span class="font-mono">{{ membership.site }}</span>
          <span class="text-muted">{{ membership.role }}</span>
          <span v-if="membership.site === me.site" class="ml-auto text-xs text-muted"
            >this one</span
          >
          <UButton
            v-else
            class="ml-auto"
            label="Switch"
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
        <h3 class="text-sm font-semibold sm:col-span-2">New site</h3>
        <UFormField label="Key" help="Lowercase words joined by hyphens. It never changes.">
          <UInput v-model="newKey" class="w-full font-mono" />
        </UFormField>
        <UFormField label="Start from">
          <USelect v-model="newPreset" :items="PRESETS" class="w-full" />
        </UFormField>
        <UFormField label="Locales" help="The first is the default." class="sm:col-span-2">
          <UInputTags v-model="newLocales" class="w-full" />
        </UFormField>
        <div class="sm:col-span-2">
          <UButton
            type="submit"
            label="Create the site"
            :disabled="!validKey || newLocales.length === 0"
            :loading="busy"
          />
        </div>
      </form>
      <div v-if="me.trash.length > 0" class="space-y-2">
        <h3 class="text-sm font-semibold">In the trash</h3>
        <ul class="divide-y divide-default rounded-lg border border-default text-sm">
          <li v-for="item in me.trash" :key="item.site" class="flex items-center gap-3 px-4 py-2.5">
            <span class="font-mono">{{ item.site }}</span>
            <span class="text-muted">since {{ when(item.deletedAt) }}</span>
            <UButton
              class="ml-auto"
              label="Restore"
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
      <h2 id="danger" class="font-semibold">Put this site in the trash</h2>
      <p class="text-sm text-muted">
        It is served no more and its tokens stop working. Nothing is deleted: restore it from
        another site you own.
      </p>
      <UButton label="Put it in the trash" color="error" variant="outline" @click="askDelete" />
    </section>

    <UModal v-model:open="deleteOpen" :title="`Put ${me.site} in the trash?`">
      <template #body>
        <p>
          It holds {{ deleteEntries }} entries. Its pages stop being served, and its tokens stop
          working.
        </p>
      </template>
      <template #footer>
        <UButton label="Keep it" variant="ghost" @click="deleteOpen = false" />
        <UButton label="Put it in the trash" color="error" @click="deleteSite" />
      </template>
    </UModal>
  </div>
  <p v-else class="text-muted">Loading…</p>
</template>
