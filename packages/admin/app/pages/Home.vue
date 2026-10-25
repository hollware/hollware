<script setup lang="ts">
import Page from '../components/Page.vue'
import { computed, onMounted, ref } from 'vue'
import type { Output } from '../lib/api.ts'
import { formatDateTime, formatNumber, useMessages } from '../i18n/index.ts'
import { entryPath, STATUS_COLOR, titleOf } from '../lib/entries.ts'
import { api } from '../lib/session.ts'

type Entry = Output<'list_entries'>['entries'][number]
type Stats = Output<'content_stats'>
type Review = Output<'list_reviews'>['reviews'][number]

const m = useMessages()
const stats = ref<Stats | null>(null)
const reviews = ref<Review[] | null>(null)
const drafts = ref<Entry[] | null>(null)
const audit = ref<Entry | null>(null)

onMounted(async () => {
  const { site } = await api.call('describe_site', {})
  const names = site.collections.map((collection) => collection.name)
  const [read, pending, ...lists] = await Promise.all([
    api.call('content_stats', { days: 30, limit: 8 }),
    api.call('list_reviews', { status: 'pending', limit: 5 }),
    ...names.map((collection) => api.call('list_entries', { collection, limit: 50 })),
  ])
  stats.value = read
  reviews.value = pending.reviews
  const everything = lists.flatMap((list) => list.entries)
  const newest = (a: Entry, b: Entry) => b.updatedAt.localeCompare(a.updatedAt)
  drafts.value = everything
    .filter((entry) => entry.status !== 'published' || entry.hasUnpublishedChanges)
    .filter((entry) => !entry.slug.startsWith('audit-'))
    .sort(newest)
    .slice(0, 6)
  audit.value =
    everything.filter((entry) => entry.slug.startsWith('audit-')).sort(newest)[0] ?? null
})

const topViews = computed(() =>
  Math.max(1, ...(stats.value?.pages ?? []).map((page) => page.views)),
)
const totalViews = computed(() =>
  (stats.value?.pages ?? []).reduce((sum, page) => sum + page.views, 0),
)
</script>

<template>
  <Page :title="m.home.title">
    <div class="space-y-8">
      <div class="grid gap-6 lg:grid-cols-[3fr_2fr]">
        <section aria-labelledby="read" class="space-y-3 rounded-lg border border-default p-5">
          <div class="flex items-baseline justify-between gap-3">
            <h2 id="read" class="font-semibold">{{ m.home.mostRead }}</h2>
            <span
              v-if="stats?.outcome === 'ok'"
              class="font-mono text-sm text-muted tabular-nums"
              >{{ m.home.views(formatNumber(totalViews)) }}</span
            >
          </div>
          <p v-if="stats === null" class="text-sm text-muted">{{ m.common.loading }}</p>
          <div v-else-if="stats.outcome === 'unavailable'" class="space-y-2 text-sm text-muted">
            <p>{{ m.home.noAnalytics }}</p>
            <RouterLink to="/settings/site#analytics" class="text-highlighted underline">{{
              m.home.connectAnalytics
            }}</RouterLink>
          </div>
          <p v-else-if="(stats.pages ?? []).length === 0" class="text-sm text-muted">
            {{ m.home.noViews }}
          </p>
          <ol v-else class="space-y-2">
            <li v-for="page in stats.pages" :key="page.path" class="space-y-1 text-sm">
              <div class="flex items-baseline justify-between gap-3">
                <RouterLink
                  v-if="page.entry !== null"
                  :to="entryPath(page.entry)"
                  class="min-w-0 truncate font-medium hover:underline"
                  >{{ titleOf(page.entry) }}</RouterLink
                >
                <span v-else class="min-w-0 truncate font-mono text-muted">{{ page.path }}</span>
                <span class="font-mono text-muted tabular-nums">{{
                  formatNumber(page.views)
                }}</span>
              </div>
              <div class="h-1 rounded-full bg-elevated" aria-hidden="true">
                <div
                  class="h-1 rounded-full bg-secondary"
                  :style="{ width: `${(page.views / topViews) * 100}%` }"
                />
              </div>
            </li>
          </ol>
        </section>

        <section aria-labelledby="waiting" class="space-y-3 rounded-lg border border-default p-5">
          <div class="flex items-baseline justify-between gap-3">
            <h2 id="waiting" class="font-semibold">{{ m.home.waiting }}</h2>
            <RouterLink to="/reviews" class="text-sm text-muted hover:text-highlighted">{{
              m.home.allReviews
            }}</RouterLink>
          </div>
          <p v-if="reviews === null" class="text-sm text-muted">{{ m.common.loading }}</p>
          <p v-else-if="reviews.length === 0" class="text-sm text-muted">
            {{ m.common.nothingWaits }}
          </p>
          <ul v-else class="divide-y divide-default text-sm">
            <li v-for="item in reviews" :key="item.id" class="py-2">
              <RouterLink to="/reviews" class="font-medium hover:underline">{{
                titleOf(item.entry)
              }}</RouterLink>
              <p class="text-muted">
                {{
                  m.home.askedBy(
                    item.requestedByName ?? item.requestedBy,
                    formatDateTime(item.requestedAt),
                  )
                }}
              </p>
            </li>
          </ul>
        </section>
      </div>

      <div class="grid gap-6 lg:grid-cols-[3fr_2fr]">
        <section aria-labelledby="drafts" class="space-y-3">
          <div class="flex items-baseline justify-between gap-3">
            <h2 id="drafts" class="font-semibold">{{ m.home.unpublished }}</h2>
            <RouterLink to="/entries" class="text-sm text-muted hover:text-highlighted">{{
              m.home.allEntries
            }}</RouterLink>
          </div>
          <p v-if="drafts === null" class="text-sm text-muted">{{ m.common.loading }}</p>
          <p v-else-if="drafts.length === 0" class="text-sm text-muted">
            {{ m.home.allPublished }}
          </p>
          <ul v-else class="divide-y divide-default rounded-lg border border-default text-sm">
            <li v-for="entry in drafts" :key="entry.id" class="flex items-center gap-3 px-4 py-2.5">
              <RouterLink
                :to="entryPath(entry)"
                class="min-w-0 flex-1 truncate font-medium hover:underline"
                >{{ titleOf(entry) }}</RouterLink
              >
              <span class="font-mono text-xs text-muted">{{ entry.locale }}</span>
              <UBadge
                :label="entry.status === 'published' ? m.home.changes : m.status[entry.status]"
                :color="entry.status === 'published' ? 'warning' : STATUS_COLOR[entry.status]"
                variant="subtle"
              />
            </li>
          </ul>
        </section>

        <section aria-labelledby="audit" class="space-y-3">
          <h2 id="audit" class="font-semibold">{{ m.home.lastAudit }}</h2>
          <p v-if="audit === null" class="text-sm text-muted">
            {{ m.home.noAudit }}
          </p>
          <RouterLink
            v-else
            :to="entryPath(audit)"
            class="block rounded-lg border border-default p-4 text-sm hover:bg-elevated"
          >
            <p class="font-medium">{{ titleOf(audit) }}</p>
            <p class="text-muted">{{ m.home.written(formatDateTime(audit.updatedAt)) }}</p>
          </RouterLink>
        </section>
      </div>
    </div>
  </Page>
</template>
