<script setup lang="ts">
import { useToast } from '@nuxt/ui/composables'
import { onMounted, ref } from 'vue'
import DiffView from '../components/DiffView.vue'
import VerdictList from '../components/VerdictList.vue'
import { ApiError, type Output } from '../lib/api.ts'
import { api } from '../lib/session.ts'

type Review = Output<'list_reviews'>['reviews'][number]
type Verdict = Output<'validate'>['verdict']
type Warning = Verdict['warnings'][number]

const toast = useToast()
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
  if (chosen.value !== null && !reviews.value.some((review) => review.id === chosen.value?.id)) {
    chosen.value = null
  }
}

onMounted(list)

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
        toast.add({ title: 'Approved and published', color: 'success' })
        await list()
        break
      case 'needs_acknowledgement':
        warnings.value = answer.verdict?.warnings ?? []
        acknowledgeOpen.value = true
        break
      case 'blocked':
        verdict.value = answer.verdict ?? verdict.value
        toast.add({
          title: 'Blocked',
          description: 'The contracts report errors now.',
          color: 'error',
        })
        break
      case 'not_pending':
      case 'not_found':
        toast.add({ title: 'This review is closed', color: 'warning' })
        await list()
        break
    }
  } catch (error) {
    report(error, 'Not approved')
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
      toast.add({ title: 'This review is closed', color: 'warning' })
      await list()
    }
  } catch (error) {
    report(error, 'Not sent')
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
      title: answer.outcome === 'changes_requested' ? 'Changes requested' : 'This review is closed',
      color: answer.outcome === 'changes_requested' ? 'success' : 'warning',
    })
    await list()
  } catch (error) {
    report(error, 'Not sent')
  } finally {
    busy.value = false
  }
}
</script>

<template>
  <div class="grid gap-6 lg:grid-cols-[18rem_1fr]">
    <section aria-label="Pending reviews" class="space-y-2">
      <h1 class="text-xl font-semibold">Reviews</h1>
      <p v-if="reviews.length === 0" class="text-muted">Nothing waits for review.</p>
      <button
        v-for="review in reviews"
        :key="review.id"
        type="button"
        class="block w-full rounded border p-2 text-left text-sm"
        :class="chosen?.id === review.id ? 'border-primary' : 'border-default'"
        @click="choose(review)"
      >
        <span class="font-medium">{{
          review.entry.frontmatter['title'] ?? review.entry.slug
        }}</span>
        <span class="block text-muted">
          {{ review.entry.locale }} · asked by {{ review.requestedByName ?? review.requestedBy }} ·
          {{ new Date(review.requestedAt).toLocaleString() }}
        </span>
      </button>
    </section>
    <section v-if="chosen !== null" aria-label="The review" class="space-y-4">
      <p class="text-sm text-muted">
        On the left what is live ({{ live === '' ? 'nothing yet' : 'the published revision' }}), on
        the right the revision asked for.
      </p>
      <DiffView :original="live" :modified="asked" />
      <VerdictList :verdict="verdict" />
      <section aria-label="Comments" class="space-y-2">
        <h2 class="text-sm font-semibold">Comments</h2>
        <p v-if="chosen.comments.length === 0" class="text-sm text-muted">No comments yet.</p>
        <article
          v-for="item in chosen.comments"
          :key="item.id"
          class="rounded border border-default p-3 text-sm"
        >
          <p class="text-muted">
            {{ item.authorName ?? item.author }}
            <UBadge v-if="item.client !== null" :label="item.client" variant="subtle" size="sm" />
            · {{ new Date(item.at).toLocaleString() }}
          </p>
          <p class="mt-1 whitespace-pre-wrap">{{ item.body }}</p>
        </article>
        <div class="flex items-end gap-3">
          <UFormField label="Comment" class="flex-1">
            <UTextarea v-model="comment" class="w-full" :rows="2" />
          </UFormField>
          <UButton
            label="Comment"
            variant="outline"
            :loading="busy"
            :disabled="comment.trim() === ''"
            @click="addComment"
          />
        </div>
      </section>
      <div class="flex flex-wrap items-end gap-3">
        <UButton label="Approve and publish" color="success" :loading="busy" @click="approve()" />
        <UFormField label="What to change" class="min-w-64 flex-1">
          <UTextarea v-model="note" class="w-full" :rows="2" />
        </UFormField>
        <UButton
          label="Ask for changes"
          color="warning"
          variant="outline"
          :loading="busy"
          :disabled="note.trim() === ''"
          @click="requestChanges"
        />
      </div>
    </section>

    <UModal v-model:open="acknowledgeOpen" title="Approve with these warnings?">
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
        <UButton label="Approve anyway" color="warning" @click="approve(warnings)" />
      </template>
    </UModal>
  </div>
</template>
