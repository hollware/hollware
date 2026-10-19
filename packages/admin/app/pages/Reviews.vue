<script setup lang="ts">
import Page from '../components/Page.vue'
import { useToast } from '@nuxt/ui/composables'
import { computed, onMounted, ref } from 'vue'
import DiffView from '../components/DiffView.vue'
import VerdictList from '../components/VerdictList.vue'
import { ApiError, type Output } from '../lib/api.ts'
import { formatDateTime, useMessages } from '../i18n/index.ts'
import { countOutcomes, runAll } from '../lib/bulk.ts'
import { useBulkReport } from '../lib/bulk-report.ts'
import { api } from '../lib/session.ts'

type Review = Output<'list_reviews'>['reviews'][number]
type Verdict = Output<'validate'>['verdict']
type Warning = Verdict['warnings'][number]

const toast = useToast()
const m = useMessages()
const reviews = ref<Review[]>([])
const chosen = ref<Review | null>(null)
const live = ref('')
const asked = ref('')
const verdict = ref<Verdict | null>(null)
const note = ref('')
const comment = ref('')
const busy = ref(false)
const warnings = ref<Warning[]>([])
const acknowledgeOpen = ref(false)

async function list() {
  reviews.value = (await api.call('list_reviews', {})).reviews
  const open = new Set(reviews.value.map((review) => review.id))
  picked.value = new Set([...picked.value].filter((id) => open.has(id)))
  if (chosen.value !== null && !reviews.value.some((review) => review.id === chosen.value?.id)) {
    chosen.value = null
  }
}

onMounted(list)

/**
 * Reviews chosen to be decided together: approved, each as approve_review approves it, or sent
 * back with one note for all. Those whose warnings have to be accepted come back together.
 */
const reportBulk = useBulkReport()
const picked = ref(new Set<string>())
const pickedReviews = computed(() => reviews.value.filter((review) => picked.value.has(review.id)))
const allPicked = computed(() =>
  picked.value.size === 0
    ? false
    : picked.value.size === reviews.value.length
      ? true
      : ('indeterminate' as const),
)
function pick(id: string, on: boolean | 'indeterminate') {
  const next = new Set(picked.value)
  if (on === true) next.add(id)
  else next.delete(id)
  picked.value = next
}
function pickAll(on: boolean | 'indeterminate') {
  picked.value = new Set(on === true ? reviews.value.map((review) => review.id) : [])
}
const titleOfReview = (review: Review) =>
  String(review.entry.frontmatter['title'] ?? review.entry.slug)

const warnedMany = ref<{ review: Review; warnings: Warning[] }[]>([])
const warnedManyOpen = computed({
  get: () => warnedMany.value.length > 0,
  set: (value: boolean) => {
    if (!value) warnedMany.value = []
  },
})
const askingMany = ref(false)
const manyNote = ref('')

async function approveMany(
  chosenReviews: readonly Review[],
  acknowledged: ReadonlyMap<string, readonly Warning[]> = new Map(),
) {
  busy.value = true
  warnedMany.value = []
  try {
    const results = await runAll(chosenReviews, (review) =>
      api.call('approve_review', {
        id: review.id,
        acknowledgeWarnings: (acknowledged.get(review.id) ?? []).map(({ contract, path }) => ({
          contract,
          path,
        })),
      }),
    )
    reportBulk(countOutcomes(results))
    warnedMany.value = results.flatMap((result) =>
      'answer' in result && result.answer.outcome === 'needs_acknowledgement'
        ? [{ review: result.item, warnings: result.answer.verdict?.warnings ?? [] }]
        : [],
    )
    await list()
  } finally {
    busy.value = false
  }
}

async function acceptManyWarnings() {
  const accepted = new Map(warnedMany.value.map(({ review, warnings }) => [review.id, warnings]))
  await approveMany(
    warnedMany.value.map(({ review }) => review),
    accepted,
  )
}

async function askChangesMany() {
  const chosenReviews = pickedReviews.value
  const body = manyNote.value
  askingMany.value = false
  busy.value = true
  try {
    reportBulk(
      countOutcomes(
        await runAll(chosenReviews, (review) =>
          api.call('request_changes', { id: review.id, note: body }),
        ),
      ),
    )
    manyNote.value = ''
    await list()
  } finally {
    busy.value = false
  }
}

async function choose(review: Review) {
  chosen.value = review
  note.value = ''
  const ref_ = {
    collection: review.entry.collection,
    locale: review.entry.locale,
    slug: review.entry.slug,
  }
  const [published, head] = await Promise.all([
    api.call('get_entry', { ...ref_, published: true }),
    api.call('get_entry', ref_),
  ])
  live.value = published.entry?.markdown ?? ''
  asked.value = head.entry?.markdown ?? ''
  verdict.value = head.entry?.verdict ?? null
}

function report(error: unknown, title: string) {
  const description = error instanceof ApiError ? `${error.message} ${error.fix}` : String(error)
  toast.add({ title, description, color: 'error' })
}

async function approve(acknowledged: readonly Warning[] = []) {
  if (chosen.value === null) return
  busy.value = true
  acknowledgeOpen.value = false
  try {
    const answer = await api.call('approve_review', {
      id: chosen.value.id,
      acknowledgeWarnings: acknowledged.map(({ contract, path }) => ({ contract, path })),
    })
    switch (answer.outcome) {
      case 'published':
        toast.add({ title: m.value.reviews.approved, color: 'success' })
        await list()
        break
      case 'needs_acknowledgement':
        warnings.value = answer.verdict?.warnings ?? []
        acknowledgeOpen.value = true
        break
      case 'blocked':
        verdict.value = answer.verdict ?? verdict.value
        toast.add({
          title: m.value.reviews.blocked,
          description: m.value.reviews.errorsNow,
          color: 'error',
        })
        break
      case 'not_pending':
      case 'not_found':
        toast.add({ title: m.value.reviews.closed, color: 'warning' })
        await list()
        break
    }
  } catch (error) {
    report(error, m.value.reviews.notApproved)
  } finally {
    busy.value = false
  }
}

async function addComment() {
  if (chosen.value === null || comment.value.trim() === '') return
  busy.value = true
  try {
    const answer = await api.call('comment_review', { id: chosen.value.id, body: comment.value })
    if (answer.outcome === 'commented' && answer.comment !== undefined) {
      chosen.value = { ...chosen.value, comments: [...chosen.value.comments, answer.comment] }
      comment.value = ''
    } else {
      toast.add({ title: m.value.reviews.closed, color: 'warning' })
      await list()
    }
  } catch (error) {
    report(error, m.value.reviews.notSent)
  } finally {
    busy.value = false
  }
}

/** Closes the review for good, with the note as the reason: it is not to be published. */
async function reject() {
  if (chosen.value === null || note.value.trim() === '') return
  busy.value = true
  try {
    const answer = await api.call('reject_review', { id: chosen.value.id, reason: note.value })
    toast.add({
      title: answer.outcome === 'rejected' ? m.value.reviews.rejected : m.value.reviews.closed,
      color: answer.outcome === 'rejected' ? 'success' : 'warning',
    })
    await list()
  } catch (error) {
    report(error, m.value.reviews.notSent)
  } finally {
    busy.value = false
  }
}

async function requestChanges() {
  if (chosen.value === null || note.value.trim() === '') return
  busy.value = true
  try {
    const answer = await api.call('request_changes', { id: chosen.value.id, note: note.value })
    toast.add({
      title:
        answer.outcome === 'changes_requested'
          ? m.value.reviews.changesRequested
          : m.value.reviews.closed,
      color: answer.outcome === 'changes_requested' ? 'success' : 'warning',
    })
    await list()
  } catch (error) {
    report(error, m.value.reviews.notSent)
  } finally {
    busy.value = false
  }
}
</script>

<template>
  <Page :title="m.reviews.title">
    <div class="grid gap-6 lg:grid-cols-[18rem_1fr]">
      <section :aria-label="m.reviews.pending" class="space-y-2">
        <p v-if="reviews.length === 0" class="text-muted">{{ m.common.nothingWaits }}</p>
        <UCheckbox
          v-else
          :model-value="allPicked"
          :label="m.bulk.selectReviews"
          class="px-2"
          @update:model-value="pickAll"
        />
        <div
          v-if="pickedReviews.length > 0"
          role="toolbar"
          :aria-label="m.table.bulk"
          class="flex flex-wrap items-center gap-2 rounded-lg border border-default bg-elevated p-2"
        >
          <span class="w-full text-sm font-medium tabular-nums">{{
            m.table.selected(pickedReviews.length)
          }}</span>
          <UButton
            :label="m.bulk.approve(pickedReviews.length)"
            color="success"
            size="sm"
            :loading="busy"
            @click="approveMany(pickedReviews)"
          />
          <UButton
            :label="m.bulk.askChanges(pickedReviews.length)"
            color="warning"
            variant="outline"
            size="sm"
            :disabled="busy"
            @click="askingMany = true"
          />
        </div>
        <div v-for="review in reviews" :key="review.id" class="flex items-start gap-2">
          <UCheckbox
            :model-value="picked.has(review.id)"
            :aria-label="m.table.selectRow(titleOfReview(review))"
            class="mt-2.5"
            @update:model-value="(on: boolean | 'indeterminate') => pick(review.id, on)"
          />
          <button
            type="button"
            class="block min-w-0 flex-1 rounded border p-2 text-left text-sm"
            :class="chosen?.id === review.id ? 'border-primary' : 'border-default'"
            @click="choose(review)"
          >
            <span class="font-medium">{{
              review.entry.frontmatter['title'] ?? review.entry.slug
            }}</span>
            <span class="block text-muted">
              {{
                m.reviews.requested(
                  review.entry.locale,
                  review.requestedByName ?? review.requestedBy,
                  formatDateTime(review.requestedAt),
                )
              }}
            </span>
          </button>
        </div>
      </section>
      <section v-if="chosen !== null" :aria-label="m.reviews.review" class="space-y-4">
        <p class="text-sm text-muted">
          {{ m.reviews.sides(live !== '') }}
        </p>
        <DiffView :original="live" :modified="asked" />
        <VerdictList :verdict="verdict" />
        <section :aria-label="m.reviews.comments" class="space-y-2">
          <h2 class="text-sm font-semibold">{{ m.reviews.comments }}</h2>
          <p v-if="chosen.comments.length === 0" class="text-sm text-muted">
            {{ m.reviews.noComments }}
          </p>
          <article
            v-for="item in chosen.comments"
            :key="item.id"
            class="rounded border border-default p-3 text-sm"
          >
            <p class="text-muted">
              {{ item.authorName ?? item.author }}
              <UBadge
                v-if="item.client !== null && item.client !== 'hollware-admin'"
                :label="item.client"
                variant="subtle"
                size="sm"
              />
              · {{ formatDateTime(item.at) }}
            </p>
            <p class="mt-1 whitespace-pre-wrap">{{ item.body }}</p>
          </article>
          <div class="flex items-end gap-3">
            <UFormField :label="m.reviews.comment" class="flex-1">
              <UTextarea v-model="comment" class="w-full" :rows="2" />
            </UFormField>
            <UButton
              :label="m.reviews.comment"
              variant="outline"
              :loading="busy"
              :disabled="comment.trim() === ''"
              @click="addComment"
            />
          </div>
        </section>
        <div class="flex flex-wrap items-end gap-3">
          <UButton :label="m.reviews.approve" color="success" :loading="busy" @click="approve()" />
          <UFormField
            :label="m.reviews.whatToChange"
            :help="m.reviews.whatToChangeHelp"
            class="min-w-64 flex-1"
          >
            <UTextarea v-model="note" class="w-full" :rows="2" />
          </UFormField>
          <UButton
            :label="m.reviews.askChanges"
            color="warning"
            variant="outline"
            :loading="busy"
            :disabled="note.trim() === ''"
            @click="requestChanges"
          />
          <UButton
            :label="m.reviews.reject"
            color="error"
            variant="outline"
            :loading="busy"
            :disabled="note.trim() === ''"
            @click="reject"
          />
        </div>
      </section>

      <UModal v-model:open="warnedManyOpen" :title="m.bulk.approveTitle(warnedMany.length)">
        <template #body>
          <ul class="space-y-4 text-sm">
            <li v-for="{ review, warnings: list } in warnedMany" :key="review.id">
              <p class="font-medium">{{ titleOfReview(review) }}</p>
              <ul class="mt-1 space-y-1">
                <li v-for="(warning, index) in list" :key="index">
                  <span class="font-mono text-xs text-muted">{{ warning.contract }}</span>
                  {{ warning.message }}
                </li>
              </ul>
            </li>
          </ul>
        </template>
        <template #footer>
          <UButton :label="m.common.cancel" variant="ghost" @click="warnedMany = []" />
          <UButton
            :label="m.reviews.approveAnyway"
            color="warning"
            :loading="busy"
            @click="acceptManyWarnings"
          />
        </template>
      </UModal>

      <UModal v-model:open="askingMany" :title="m.bulk.askChangesTitle(pickedReviews.length)">
        <template #body>
          <UFormField :label="m.reviews.whatToChange" :help="m.bulk.askChangesHelp">
            <UTextarea v-model="manyNote" class="w-full" :rows="3" />
          </UFormField>
        </template>
        <template #footer>
          <UButton :label="m.common.cancel" variant="ghost" @click="askingMany = false" />
          <UButton
            :label="m.bulk.askChanges(pickedReviews.length)"
            color="warning"
            :disabled="manyNote.trim() === ''"
            @click="askChangesMany"
          />
        </template>
      </UModal>

      <UModal v-model:open="acknowledgeOpen" :title="m.reviews.approveTitle">
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
          <UButton :label="m.reviews.approveAnyway" color="warning" @click="approve(warnings)" />
        </template>
      </UModal>
    </div>
  </Page>
</template>
