<script setup lang="ts">
import Page from '../components/Page.vue'
import { defineShortcuts, useToast } from '@nuxt/ui/composables'
import { computed, ref, watch } from 'vue'
import FrontmatterForm from '../components/FrontmatterForm.vue'
import MarkdownEditor from '../components/MarkdownEditor.vue'
import VerdictList from '../components/VerdictList.vue'
import { ApiError, type Output } from '../lib/api.ts'
import { diagnosticsOf } from '../lib/diagnostics.ts'
import { entryPath, STATUS_COLOR, titleOf, when } from '../lib/entries.ts'
import { api } from '../lib/session.ts'
import { pageUrl } from '../lib/site.ts'

const props = defineProps<{ collection: string; locale: string; slug: string }>()

type Site = Output<'describe_site'>['site']
type Entry = NonNullable<Output<'get_entry'>['entry']>
type Summary = Output<'list_entries'>['entries'][number]
type Verdict = Output<'validate'>['verdict']
type Warning = Verdict['warnings'][number]

const toast = useToast()
const site = ref<Site | null>(null)
const entry = ref<Entry | null>(null)
const related = ref<Summary[]>([])
const translations = ref<Summary[]>([])
const missing = ref(false)
const text = ref('')
/** The Markdown as it was last loaded or saved: what tells an unsaved change. */
const saved = ref('')
const verdict = ref<Verdict | null>(null)
const busy = ref(false)
const conflictOpen = ref(false)
const warnings = ref<Warning[]>([])
const acknowledgeOpen = ref(false)
const unpublishOpen = ref(false)
const scheduleOpen = ref(false)
const publishAt = ref('')
/** What publish waits for once the warnings are acknowledged: now, or a time. */
let pendingAt: string | undefined

const ref_ = computed(() => ({
  collection: props.collection,
  locale: props.locale,
  slug: props.slug,
}))
const definition = computed(() =>
  site.value?.collections.find((candidate) => candidate.name === props.collection),
)
const dirty = computed(() => text.value !== saved.value)
const diagnostics = computed(() =>
  verdict.value === null ? [] : diagnosticsOf(text.value, verdict.value),
)
const liveUrl = computed(() =>
  entry.value?.status === 'published' && definition.value !== undefined
    ? pageUrl(site.value?.url ?? null, definition.value.routes, props.locale, props.slug)
    : null,
)
/** The locales of the site with no entry in this one's translation group yet. */
const untranslated = computed(() =>
  entry.value?.translationGroup === null || entry.value === null
    ? []
    : (site.value?.locales ?? []).filter(
        (locale) => !translations.value.some((other) => other.locale === locale),
      ),
)
const canPublish = computed(
  () =>
    entry.value !== null &&
    !dirty.value &&
    (entry.value.status !== 'published' || entry.value.hasUnpublishedChanges),
)

async function load() {
  const [described, read] = await Promise.all([
    site.value === null ? api.call('describe_site', {}) : null,
    api.call('get_entry', { ...ref_.value, formats: ['markdown', 'html'], related: true }),
  ])
  if (described !== null) site.value = described.site
  if (read.outcome === 'not_found' || read.entry === undefined) {
    missing.value = true
    return
  }
  missing.value = false
  entry.value = read.entry
  related.value = read.related ?? []
  text.value = read.entry.markdown ?? ''
  saved.value = text.value
  verdict.value = read.entry.verdict
  translations.value =
    read.entry.translationGroup === null
      ? []
      : ((
          await api.call('get_translations', {
            collection: props.collection,
            translationGroup: read.entry.translationGroup,
          })
        ).entries ?? [])
}

// Another entry of the same page (a translation, a related one) loads in place.
watch(ref_, load, { immediate: true })

// The contracts run again a moment after the person stops typing, without saving anything.
let timer: ReturnType<typeof setTimeout> | undefined
watch(text, (markdown) => {
  clearTimeout(timer)
  if (markdown === saved.value) return
  timer = setTimeout(async () => {
    verdict.value = (await api.call('validate', { ...ref_.value, markdown })).verdict
  }, 600)
})

function report(error: unknown, title: string) {
  const description = error instanceof ApiError ? `${error.message} ${error.fix}` : String(error)
  toast.add({ title, description, color: 'error' })
}

async function check() {
  busy.value = true
  try {
    verdict.value = (await api.call('validate', { ...ref_.value, markdown: text.value })).verdict
    const { errors, warnings: found } = verdict.value
    toast.add({
      title:
        errors.length === 0 && found.length === 0
          ? 'Every contract passes'
          : `${errors.length} errors, ${found.length} warnings`,
      color: errors.length > 0 ? 'error' : found.length > 0 ? 'warning' : 'success',
    })
  } catch (error) {
    report(error, 'Not checked')
  } finally {
    busy.value = false
  }
}

async function save() {
  if (entry.value === null || !dirty.value) return
  busy.value = true
  try {
    const answer = await api.call('update_draft', {
      id: entry.value.id,
      version: entry.value.version,
      markdown: text.value,
    })
    switch (answer.outcome) {
      case 'saved':
      case 'unchanged':
        await load()
        toast.add({
          title: answer.outcome === 'saved' ? 'Saved' : 'Nothing changed',
          color: 'success',
        })
        break
      case 'conflict':
        conflictOpen.value = true
        break
      case 'refused':
        verdict.value = answer.verdict ?? verdict.value
        toast.add({
          title: 'Not saved',
          description: 'See what the contracts say.',
          color: 'error',
        })
        break
      case 'not_found':
        missing.value = true
        break
    }
  } catch (error) {
    report(error, 'Not saved')
  } finally {
    busy.value = false
  }
}

defineShortcuts({ meta_s: () => void save() })

async function publish(acknowledged: readonly Warning[] = [], at?: string) {
  if (entry.value === null) return
  busy.value = true
  acknowledgeOpen.value = false
  scheduleOpen.value = false
  try {
    const answer = await api.call('publish', {
      id: entry.value.id,
      version: entry.value.version,
      acknowledgeWarnings: acknowledged.map(({ contract, path }) => ({ contract, path })),
      ...(at === undefined ? {} : { publishAt: at }),
    })
    switch (answer.outcome) {
      case 'published':
        await load()
        toast.add({ title: 'Published', color: 'success' })
        break
      case 'scheduled':
        await load()
        toast.add({
          title: 'Scheduled',
          description: `It is published at ${when(answer.entry?.scheduledAt ?? at ?? '')}.`,
          color: 'info',
        })
        break
      case 'pending_review':
        toast.add({
          title: 'Sent for review',
          description: 'A person who may publish will approve it, or ask for changes.',
          color: 'info',
        })
        break
      case 'needs_acknowledgement':
        warnings.value = answer.verdict?.warnings ?? []
        pendingAt = at
        acknowledgeOpen.value = true
        break
      case 'blocked':
        verdict.value = answer.verdict ?? verdict.value
        toast.add({ title: 'Blocked', description: 'Fix the errors first.', color: 'error' })
        break
      case 'conflict':
        conflictOpen.value = true
        break
      case 'not_found':
        await load()
        break
    }
  } catch (error) {
    report(error, at === undefined ? 'Not published' : 'Not scheduled')
  } finally {
    busy.value = false
  }
}

function openSchedule() {
  // An hour from now, to the minute, in the person's own zone: what a datetime-local input shows.
  const soon = new Date(Date.now() + 3_600_000)
  soon.setSeconds(0, 0)
  publishAt.value = new Date(soon.getTime() - soon.getTimezoneOffset() * 60_000)
    .toISOString()
    .slice(0, 16)
  scheduleOpen.value = true
}

const scheduleError = computed(() => {
  const at = Date.parse(publishAt.value)
  if (Number.isNaN(at)) return 'Pick a date and a time.'
  return at <= Date.now() ? 'Pick a time in the future.' : null
})

async function unpublish() {
  if (entry.value === null) return
  const wasScheduled = entry.value.status === 'scheduled'
  busy.value = true
  unpublishOpen.value = false
  try {
    await api.call('unpublish', { id: entry.value.id })
    await load()
    toast.add({
      title: wasScheduled ? 'Schedule cancelled' : 'Unpublished',
      description: 'The entry is a draft again, with all its revisions.',
      color: 'success',
    })
  } catch (error) {
    report(error, wasScheduled ? 'Not cancelled' : 'Not unpublished')
  } finally {
    busy.value = false
  }
}

async function reloadTheirs() {
  conflictOpen.value = false
  await load()
}

const tabs = [
  { label: 'Fields', slot: 'fields' as const, value: 'fields' },
  { label: 'Checks', slot: 'checks' as const, value: 'checks' },
  { label: 'Preview', slot: 'preview' as const, value: 'preview' },
  { label: 'Related', slot: 'related' as const, value: 'related' },
]
</script>

<template>
  <Page :title="entry === null ? 'Entry' : titleOf(entry)">
    <template v-if="entry !== null" #actions>
      <UButton
        v-if="liveUrl !== null"
        :to="liveUrl"
        target="_blank"
        label="View on site"
        icon="i-lucide-external-link"
        variant="ghost"
      />
      <UButton label="Validate" variant="outline" :loading="busy" @click="check" />
      <UButton label="Save" :loading="busy" :disabled="!dirty" @click="save" />
      <UButton
        label="Publish"
        color="secondary"
        :loading="busy"
        :disabled="!canPublish"
        @click="publish()"
      />
      <UButton
        v-if="entry.status === 'draft'"
        label="Schedule"
        icon="i-lucide-calendar-clock"
        variant="outline"
        :disabled="dirty"
        @click="openSchedule"
      />
      <UButton
        v-if="entry.status !== 'draft'"
        :label="entry.status === 'scheduled' ? 'Cancel schedule' : 'Unpublish'"
        color="error"
        variant="outline"
        :loading="busy"
        @click="unpublishOpen = true"
      />
    </template>
    <p v-if="missing" class="text-muted">There is no such entry.</p>
    <div v-else-if="entry !== null" class="space-y-5">
      <div class="space-y-3">
        <div class="flex flex-wrap items-start gap-3">
          <div class="min-w-0 flex-1 space-y-1">
            <p class="flex flex-wrap items-center gap-2 text-sm text-muted">
              <UBadge :label="entry.status" :color="STATUS_COLOR[entry.status]" variant="subtle" />
              <UBadge
                v-if="entry.status === 'published' && entry.hasUnpublishedChanges"
                label="unpublished changes"
                color="warning"
                variant="outline"
              />
              <span v-if="entry.scheduledAt !== null">publishes {{ when(entry.scheduledAt) }}</span>
              <span class="font-mono"
                >{{ entry.collection }}/{{ entry.slug }} · v{{ entry.version }}</span
              >
              <span v-if="dirty" class="text-warning">unsaved</span>
            </p>
          </div>
        </div>
        <nav
          v-if="entry.translationGroup !== null"
          aria-label="Translations"
          class="flex flex-wrap items-center gap-2 text-sm"
        >
          <span class="text-muted">Translations</span>
          <template v-for="other in translations" :key="other.id">
            <span
              v-if="other.id === entry.id"
              aria-current="page"
              class="rounded-md bg-elevated px-2 py-0.5 font-mono text-highlighted"
              >{{ other.locale }}</span
            >
            <RouterLink
              v-else
              :to="entryPath(other)"
              :aria-label="`${titleOf(other)} (${other.locale})`"
              class="rounded-md border border-default px-2 py-0.5 font-mono hover:bg-elevated"
              >{{ other.locale }}</RouterLink
            >
          </template>
          <UButton
            v-for="locale in untranslated"
            :key="locale"
            :to="{
              path: '/entries/new',
              query: { collection: entry.collection, locale, group: entry.translationGroup },
            }"
            :label="`Translate to ${locale}`"
            icon="i-lucide-plus"
            size="xs"
            variant="ghost"
          />
        </nav>
      </div>

      <div class="grid gap-4 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <MarkdownEditor v-model="text" :diagnostics="diagnostics" />
        <UTabs :items="tabs" default-value="fields" class="min-w-0" variant="link">
          <template #fields>
            <div class="pt-3">
              <FrontmatterForm v-model="text" :schema="definition?.schema ?? {}" />
            </div>
          </template>
          <template #checks>
            <div class="pt-3">
              <VerdictList :verdict="verdict" />
            </div>
          </template>
          <template #preview>
            <section
              aria-label="Preview of the saved revision"
              class="prose mt-3 max-w-none rounded border border-default p-4"
            >
              <!-- The HTML that Hollware renders from Comark, which escapes what it does not know. -->
              <div v-html="entry.html ?? ''" />
            </section>
          </template>
          <template #related>
            <div class="space-y-2 pt-3 text-sm">
              <p v-if="related.length === 0" class="text-muted">
                Nothing related yet. Related entries come from the semantic search of the
                deployment, for published entries.
              </p>
              <RouterLink
                v-for="other in related"
                :key="other.id"
                :to="entryPath(other)"
                class="block rounded border border-default px-3 py-2 hover:bg-elevated"
              >
                <span class="font-medium">{{ titleOf(other) }}</span>
                <span class="block font-mono text-xs text-muted">{{ other.slug }}</span>
              </RouterLink>
            </div>
          </template>
        </UTabs>
      </div>

      <UModal v-model:open="conflictOpen" title="Someone changed this entry">
        <template #body>
          <p>
            The entry is at a newer version than the one you edited. Copy what you wrote if you need
            it, then load the newer version.
          </p>
        </template>
        <template #footer>
          <UButton label="Keep editing" variant="ghost" @click="conflictOpen = false" />
          <UButton label="Load the newer version" color="warning" @click="reloadTheirs" />
        </template>
      </UModal>

      <UModal v-model:open="acknowledgeOpen" title="Publish with these warnings?">
        <template #body>
          <ul class="space-y-2 text-sm">
            <li v-for="(warning, index) in warnings" :key="index">
              <span class="font-mono text-xs text-muted">{{ warning.contract }}</span>
              <p>{{ warning.message }}</p>
              <p class="text-muted">{{ warning.fix }}</p>
            </li>
          </ul>
        </template>
        <template #footer>
          <UButton label="Cancel" variant="ghost" @click="acknowledgeOpen = false" />
          <UButton
            :label="pendingAt === undefined ? 'Publish anyway' : 'Schedule anyway'"
            color="warning"
            @click="publish(warnings, pendingAt)"
          />
        </template>
      </UModal>

      <UModal
        v-model:open="unpublishOpen"
        :title="entry.status === 'scheduled' ? 'Cancel the schedule?' : 'Unpublish this entry?'"
      >
        <template #body>
          <p v-if="entry.status === 'scheduled'">
            The entry stays a draft and is not published at {{ when(entry.scheduledAt ?? '') }}.
          </p>
          <p v-else>
            The entry leaves the public site: its page answers 404 and it drops out of listings and
            search. It stays here as a draft, with all its revisions, and can be published again.
          </p>
        </template>
        <template #footer>
          <UButton label="Keep it" variant="ghost" @click="unpublishOpen = false" />
          <UButton
            :label="entry.status === 'scheduled' ? 'Cancel the schedule' : 'Unpublish'"
            color="error"
            @click="unpublish"
          />
        </template>
      </UModal>

      <UModal v-model:open="scheduleOpen" title="Schedule the publication">
        <template #body>
          <UFormField
            label="Publish at"
            help="In your time zone. It is published within a minute of the time, unless it changes first."
            :error="scheduleError ?? undefined"
          >
            <UInput v-model="publishAt" type="datetime-local" class="w-full" />
          </UFormField>
        </template>
        <template #footer>
          <UButton label="Cancel" variant="ghost" @click="scheduleOpen = false" />
          <UButton
            label="Schedule"
            :disabled="scheduleError !== null"
            @click="publish([], new Date(publishAt).toISOString())"
          />
        </template>
      </UModal>
    </div>
    <p v-else class="text-muted">Loading…</p>
  </Page>
</template>
