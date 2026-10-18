<script setup lang="ts">
import Page from '../components/Page.vue'
import { defineShortcuts, useToast } from '@nuxt/ui/composables'
import { computed, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import FrontmatterForm from '../components/FrontmatterForm.vue'
import RevisionHistory from '../components/RevisionHistory.vue'
import MarkdownEditor from '../components/MarkdownEditor.vue'
import VerdictList from '../components/VerdictList.vue'
import { ApiError, type Output } from '../lib/api.ts'
import { diagnosticsOf } from '../lib/diagnostics.ts'
import { formatDateTime, useMessages } from '../i18n/index.ts'
import { entryPath, STATUS_COLOR, titleOf } from '../lib/entries.ts'
import { api } from '../lib/session.ts'
import { pageUrl } from '../lib/site.ts'
import { openPreview } from '../lib/site-preview.ts'
import { previewDocument } from '../lib/preview.ts'

const props = defineProps<{ collection: string; locale: string; slug: string }>()

type Site = Output<'describe_site'>['site']
type Entry = NonNullable<Output<'get_entry'>['entry']>
type Summary = Output<'list_entries'>['entries'][number]
type Verdict = Output<'validate'>['verdict']
type Warning = Verdict['warnings'][number]

const toast = useToast()
const m = useMessages()
const router = useRouter()
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
const trashOpen = ref(false)
const scheduleOpen = ref(false)
/** What the dialog of a time schedules: the publication of a draft, or the end of a published one. */
const scheduleMode = ref<'publish' | 'unpublish'>('publish')
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
/** Whether the site has a page for this entry to preview on: its URL, and a route for the locale. */
const canPreview = computed(
  () =>
    definition.value !== undefined &&
    pageUrl(site.value?.url ?? null, definition.value.routes, props.locale, props.slug) !== null,
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
          ? m.value.entry.allPass
          : m.value.entry.counts(errors.length, found.length),
      color: errors.length > 0 ? 'error' : found.length > 0 ? 'warning' : 'success',
    })
  } catch (error) {
    report(error, m.value.entry.notChecked)
  } finally {
    busy.value = false
  }
}

/** Opens the entry's page on the site with a link that shows its latest revision, for an hour. */
async function previewOnSite() {
  if (entry.value === null) return
  busy.value = true
  // The tab is opened in the click itself, before the link is asked for: a browser (Safari) blocks
  // a tab opened after an await. It leaves no hold on this page, and closes if there is no link.
  const tab = window.open('', '_blank')
  if (tab !== null) tab.opener = null
  try {
    const result = await openPreview(api, entry.value.id, (url) => {
      if (tab === null) window.open(url, '_blank', 'noopener')
      else tab.location.replace(url)
    })
    if (result !== 'opened') tab?.close()
    toast.add(
      result === 'opened'
        ? {
            title: m.value.entry.previewOpened,
            description: m.value.entry.previewOpenedBody,
            color: 'success',
          }
        : {
            title: m.value.entry.notPreviewed,
            description: m.value.entry.previewNoUrl,
            color: 'warning',
          },
    )
  } catch (error) {
    tab?.close()
    report(error, m.value.entry.notPreviewed)
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
          title: answer.outcome === 'saved' ? m.value.entry.saved : m.value.entry.nothingChanged,
          color: 'success',
        })
        break
      case 'conflict':
        conflictOpen.value = true
        break
      case 'refused':
        verdict.value = answer.verdict ?? verdict.value
        toast.add({
          title: m.value.entry.notSaved,
          description: m.value.entry.seeContracts,
          color: 'error',
        })
        break
      case 'not_found':
        missing.value = true
        break
    }
  } catch (error) {
    report(error, m.value.entry.notSaved)
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
        toast.add({ title: m.value.entry.published, color: 'success' })
        break
      case 'scheduled':
        await load()
        toast.add({
          title: m.value.entry.scheduled,
          description: m.value.entry.publishedAt(
            formatDateTime(answer.entry?.scheduledAt ?? at ?? ''),
          ),
          color: 'info',
        })
        break
      case 'pending_review':
        toast.add({
          title: m.value.entry.sentForReview,
          description: m.value.entry.reviewNext,
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
        toast.add({
          title: m.value.entry.blocked,
          description: m.value.entry.fixErrors,
          color: 'error',
        })
        break
      case 'conflict':
        conflictOpen.value = true
        break
      case 'not_found':
        await load()
        break
    }
  } catch (error) {
    report(error, at === undefined ? m.value.entry.notPublished : m.value.entry.notScheduled)
  } finally {
    busy.value = false
  }
}

function openSchedule(mode: 'publish' | 'unpublish' = 'publish') {
  scheduleMode.value = mode
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
  if (Number.isNaN(at)) return m.value.entry.pickDateTime
  return at <= Date.now() ? m.value.entry.pickFuture : null
})

/** Takes a published entry off the site at the time of the dialog, or keeps it with `null`. */
async function scheduleUnpublish(at: string | null) {
  if (entry.value === null) return
  busy.value = true
  scheduleOpen.value = false
  try {
    const answer = await api.call('schedule_unpublish', { id: entry.value.id, unpublishAt: at })
    await load()
    toast.add({
      title:
        answer.outcome === 'scheduled'
          ? m.value.entry.unpublishScheduled
          : answer.outcome === 'unpublished'
            ? m.value.entry.unpublished
            : m.value.entry.unpublishKept,
      color: 'success',
    })
  } catch (error) {
    report(error, m.value.entry.notScheduledUnpublish)
  } finally {
    busy.value = false
  }
}

async function unpublish() {
  if (entry.value === null) return
  const wasScheduled = entry.value.status === 'scheduled'
  busy.value = true
  unpublishOpen.value = false
  try {
    await api.call('unpublish', { id: entry.value.id })
    await load()
    toast.add({
      title: wasScheduled ? m.value.entry.scheduleCancelled : m.value.entry.unpublished,
      description: m.value.entry.draftAgain,
      color: 'success',
    })
  } catch (error) {
    report(error, wasScheduled ? m.value.entry.notCancelled : m.value.entry.notUnpublished)
  } finally {
    busy.value = false
  }
}

/** Moves the draft to the trash, and goes back to the entries of its collection. */
async function trash() {
  if (entry.value === null) return
  busy.value = true
  trashOpen.value = false
  try {
    const answer = await api.call('delete_entry', {
      id: entry.value.id,
      version: entry.value.version,
    })
    switch (answer.outcome) {
      case 'trashed':
        toast.add({
          title: m.value.entry.trashed,
          description: m.value.entry.trashedBody,
          color: 'success',
        })
        await router.push({ path: '/entries', query: { collection: props.collection } })
        break
      case 'conflict':
        conflictOpen.value = true
        break
      case 'published':
      case 'not_found':
        await load()
        toast.add({ title: m.value.entry.notTrashed, color: 'error' })
        break
    }
  } catch (error) {
    report(error, m.value.entry.notTrashed)
  } finally {
    busy.value = false
  }
}

async function reloadTheirs() {
  conflictOpen.value = false
  await load()
}

const tabs = computed(() => [
  { label: m.value.entry.tabs.fields, slot: 'fields' as const, value: 'fields' },
  { label: m.value.entry.tabs.checks, slot: 'checks' as const, value: 'checks' },
  { label: m.value.entry.tabs.preview, slot: 'preview' as const, value: 'preview' },
  { label: m.value.entry.tabs.related, slot: 'related' as const, value: 'related' },
  { label: m.value.entry.tabs.history, slot: 'history' as const, value: 'history' },
])
</script>

<template>
  <Page :title="entry === null ? m.entry.title : titleOf(entry)">
    <template v-if="entry !== null" #actions>
      <UButton
        v-if="liveUrl !== null"
        :to="liveUrl"
        target="_blank"
        :label="m.entry.viewOnSite"
        icon="i-lucide-external-link"
        variant="ghost"
      />
      <span :title="canPreview ? undefined : m.entry.previewNoUrl">
        <UButton
          :label="m.entry.previewOnSite"
          icon="i-lucide-eye"
          variant="outline"
          :loading="busy"
          :disabled="!canPreview"
          :aria-describedby="canPreview ? undefined : 'preview-unavailable'"
          @click="previewOnSite"
        />
      </span>
      <span v-if="!canPreview" id="preview-unavailable" class="sr-only">{{
        m.entry.previewNoUrl
      }}</span>
      <UButton :label="m.entry.validate" variant="outline" :loading="busy" @click="check" />
      <UButton :label="m.entry.save" :loading="busy" :disabled="!dirty" @click="save" />
      <UButton
        :label="m.entry.publish"
        color="secondary"
        :loading="busy"
        :disabled="!canPublish"
        @click="publish()"
      />
      <UButton
        v-if="entry.status === 'draft'"
        :label="m.entry.schedule"
        icon="i-lucide-calendar-clock"
        variant="outline"
        :disabled="dirty"
        @click="openSchedule('publish')"
      />
      <UButton
        v-if="entry.status === 'published' && entry.unpublishAt === null"
        :label="m.entry.unpublishLater"
        icon="i-lucide-calendar-x"
        variant="outline"
        @click="openSchedule('unpublish')"
      />
      <UButton
        v-if="entry.status !== 'draft'"
        :label="entry.status === 'scheduled' ? m.entry.cancelSchedule : m.entry.unpublish"
        color="error"
        variant="outline"
        :loading="busy"
        @click="unpublishOpen = true"
      />
      <UButton
        v-if="entry.status === 'draft'"
        :label="m.entry.moveToTrash"
        icon="i-lucide-trash-2"
        color="error"
        variant="ghost"
        :disabled="busy"
        @click="trashOpen = true"
      />
    </template>
    <p v-if="missing" class="text-muted">{{ m.entry.missing }}</p>
    <div v-else-if="entry !== null" class="space-y-5">
      <div class="space-y-3">
        <div class="flex flex-wrap items-start gap-3">
          <div class="min-w-0 flex-1 space-y-1">
            <p class="flex flex-wrap items-center gap-2 text-sm text-muted">
              <UBadge
                :label="m.status[entry.status]"
                :color="STATUS_COLOR[entry.status]"
                variant="subtle"
              />
              <UBadge
                v-if="entry.status === 'published' && entry.hasUnpublishedChanges"
                :label="m.entry.unpublishedChanges"
                color="warning"
                variant="outline"
              />
              <span v-if="entry.scheduledAt !== null">{{
                m.entry.publishes(formatDateTime(entry.scheduledAt))
              }}</span>
              <template v-if="entry.unpublishAt !== null">
                <UBadge
                  :label="m.entry.leaves(formatDateTime(entry.unpublishAt))"
                  color="warning"
                  variant="outline"
                  icon="i-lucide-calendar-x"
                />
                <UButton
                  :label="m.entry.keepPublished"
                  size="xs"
                  variant="ghost"
                  :loading="busy"
                  @click="scheduleUnpublish(null)"
                />
              </template>
              <span class="font-mono"
                >{{ entry.collection }}/{{ entry.slug }} ·
                {{ m.entry.version(entry.version) }}</span
              >
              <span v-if="dirty" class="text-warning">{{ m.entry.unsaved }}</span>
            </p>
          </div>
        </div>
        <nav
          v-if="entry.translationGroup !== null"
          :aria-label="m.entry.translations"
          class="flex flex-wrap items-center gap-2 text-sm"
        >
          <span class="text-muted">{{ m.entry.translations }}</span>
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
              :aria-label="`${other.locale} · ${titleOf(other)}`"
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
            :label="m.entry.translateTo(locale)"
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
            <!-- The HTML that Hollware renders, in a frame that runs nothing and reaches nothing of
                 the admin (T-60): its styles cannot draw over the admin. -->
            <iframe
              sandbox=""
              referrerpolicy="no-referrer"
              :title="m.entry.preview"
              :srcdoc="previewDocument(entry.html ?? '', locale)"
              class="mt-3 h-[70vh] w-full rounded border border-default"
            />
          </template>
          <template #related>
            <div class="space-y-2 pt-3 text-sm">
              <p v-if="related.length === 0" class="text-muted">
                {{ m.entry.noRelated }}
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
          <template #history>
            <RevisionHistory
              :entry-id="entry.id"
              :version="entry.version"
              :latest="saved"
              :dirty="dirty"
              @restored="load"
              @conflict="conflictOpen = true"
            />
          </template>
        </UTabs>
      </div>

      <UModal v-model:open="conflictOpen" :title="m.entry.conflictTitle">
        <template #body>
          <p>{{ m.entry.conflictBody }}</p>
        </template>
        <template #footer>
          <UButton :label="m.entry.keepEditing" variant="ghost" @click="conflictOpen = false" />
          <UButton :label="m.entry.loadNewer" color="warning" @click="reloadTheirs" />
        </template>
      </UModal>

      <UModal v-model:open="acknowledgeOpen" :title="m.entry.acknowledgeTitle">
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
          <UButton :label="m.common.cancel" variant="ghost" @click="acknowledgeOpen = false" />
          <UButton
            :label="pendingAt === undefined ? m.entry.publishAnyway : m.entry.scheduleAnyway"
            color="warning"
            @click="publish(warnings, pendingAt)"
          />
        </template>
      </UModal>

      <UModal
        v-model:open="unpublishOpen"
        :title="entry.status === 'scheduled' ? m.entry.cancelScheduleTitle : m.entry.unpublishTitle"
      >
        <template #body>
          <p v-if="entry.status === 'scheduled'">
            {{ m.entry.notPublishedAt(formatDateTime(entry.scheduledAt ?? '')) }}
          </p>
          <p v-else>{{ m.entry.unpublishBody }}</p>
        </template>
        <template #footer>
          <UButton :label="m.common.keepIt" variant="ghost" @click="unpublishOpen = false" />
          <UButton
            :label="entry.status === 'scheduled' ? m.entry.cancelTheSchedule : m.entry.unpublish"
            color="error"
            @click="unpublish"
          />
        </template>
      </UModal>

      <UModal v-model:open="trashOpen" :title="m.entry.trashTitle">
        <template #body>
          <p>{{ m.entry.trashBody }}</p>
        </template>
        <template #footer>
          <UButton :label="m.common.keepIt" variant="ghost" @click="trashOpen = false" />
          <UButton :label="m.entry.moveToTrash" color="error" @click="trash" />
        </template>
      </UModal>

      <UModal
        v-model:open="scheduleOpen"
        :title="scheduleMode === 'publish' ? m.entry.scheduleTitle : m.entry.unpublishAtTitle"
      >
        <template #body>
          <UFormField
            :label="scheduleMode === 'publish' ? m.entry.publishAt : m.entry.unpublishAt"
            :help="scheduleMode === 'publish' ? m.entry.publishAtHelp : m.entry.unpublishAtHelp"
            :error="scheduleError ?? undefined"
          >
            <UInput v-model="publishAt" type="datetime-local" class="w-full" />
          </UFormField>
        </template>
        <template #footer>
          <UButton :label="m.common.cancel" variant="ghost" @click="scheduleOpen = false" />
          <UButton
            :label="scheduleMode === 'publish' ? m.entry.schedule : m.entry.unpublishLater"
            :disabled="scheduleError !== null"
            @click="
              scheduleMode === 'publish'
                ? publish([], new Date(publishAt).toISOString())
                : scheduleUnpublish(new Date(publishAt).toISOString())
            "
          />
        </template>
      </UModal>
    </div>
    <p v-else class="text-muted">{{ m.common.loading }}</p>
  </Page>
</template>
