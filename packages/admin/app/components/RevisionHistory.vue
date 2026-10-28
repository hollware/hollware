<script setup lang="ts">
import { useToast } from '@nuxt/ui/composables'
import { ref, watch } from 'vue'
import DiffView from './DiffView.vue'
import { ApiError, type Output } from '../lib/api.ts'
import { formatDateTime, formatNumber, useMessages } from '../i18n/index.ts'
import { api } from '../lib/session.ts'
import { personName } from '../lib/people.ts'

const props = defineProps<{
  entryId: string
  version: number
  latest: string
  dirty: boolean
}>()
const emit = defineEmits<{ restored: []; conflict: [] }>()

type Revision = NonNullable<Output<'list_revisions'>['revisions']>[number]

const m = useMessages()
const toast = useToast()
const revisions = ref<Revision[]>([])
const next = ref<string | null>(null)
const loading = ref(false)
const open = ref(false)
const chosen = ref<Revision | null>(null)
const chosenMarkdown = ref('')
const busy = ref(false)

async function load(cursor?: string) {
  loading.value = true
  try {
    const answer = await api.call('list_revisions', {
      id: props.entryId,
      limit: 20,
      ...(cursor === undefined ? {} : { cursor }),
    })
    const page = answer.revisions ?? []
    revisions.value = cursor === undefined ? page : [...revisions.value, ...page]
    next.value = answer.nextCursor ?? null
  } finally {
    loading.value = false
  }
}

watch(
  () => [props.entryId, props.version],
  () => void load(),
  { immediate: true },
)

async function show(revision: Revision) {
  chosen.value = revision
  chosenMarkdown.value = ''
  open.value = true
  const answer = await api.call('get_revision', { id: revision.id })
  chosenMarkdown.value = answer.revision?.markdown ?? ''
}

async function restore() {
  if (chosen.value === null) return
  busy.value = true
  try {
    const answer = await api.call('restore_revision', {
      id: props.entryId,
      version: props.version,
      revision: chosen.value.id,
    })
    switch (answer.outcome) {
      case 'saved':
      case 'unchanged':
        open.value = false
        toast.add({
          title:
            answer.outcome === 'saved' ? m.value.history.restored : m.value.entry.nothingChanged,
          color: 'success',
        })
        emit('restored')
        break
      case 'conflict':
        open.value = false
        emit('conflict')
        break
      default:
        toast.add({ title: m.value.history.notRestored, color: 'error' })
    }
  } catch (error) {
    const description = error instanceof ApiError ? `${error.message} ${error.fix}` : String(error)
    toast.add({ title: m.value.history.notRestored, description, color: 'error' })
  } finally {
    busy.value = false
  }
}

function author(revision: Revision): string {
  const who = personName(revision.author, revision.authorName, m.value.people.formerPerson)
  return revision.client === null ? who : `${who} · ${revision.client}`
}
</script>

<template>
  <div class="space-y-2 pt-3 text-sm">
    <p v-if="!loading && revisions.length === 0" class="text-muted">{{ m.history.empty }}</p>
    <ol class="space-y-2" :aria-label="m.history.title">
      <li v-for="revision in revisions" :key="revision.id">
        <button
          type="button"
          class="block w-full rounded border border-default px-3 py-2 text-left hover:bg-elevated"
          @click="show(revision)"
        >
          <span class="flex flex-wrap items-center gap-2">
            <span class="font-medium tabular-nums">{{ formatDateTime(revision.createdAt) }}</span>
            <UBadge
              v-if="revision.head"
              :label="m.history.latest"
              color="neutral"
              variant="subtle"
            />
            <UBadge v-if="revision.live" :label="m.history.live" color="success" variant="subtle" />
            <UBadge
              v-else-if="revision.published"
              :label="m.history.publishedBefore"
              color="neutral"
              variant="outline"
            />
          </span>
          <span class="block text-muted">{{ author(revision) }}</span>
          <span class="block text-xs text-muted">
            {{ revision.title ?? m.history.untitled }} ·
            {{ m.history.words(formatNumber(revision.wordCount)) }} ·
            {{ m.history.checks(revision.errors, revision.warnings) }}
          </span>
        </button>
      </li>
    </ol>
    <UButton
      v-if="next !== null"
      :label="m.history.older"
      variant="ghost"
      size="sm"
      :loading="loading"
      @click="load(next)"
    />

    <UModal
      v-model:open="open"
      :title="
        chosen === null ? m.history.title : m.history.dialogTitle(formatDateTime(chosen.createdAt))
      "
      :ui="{ content: 'sm:max-w-5xl' }"
    >
      <template #body>
        <div class="space-y-3">
          <p class="text-muted">{{ m.history.compared }}</p>
          <DiffView
            :original="chosenMarkdown"
            :modified="latest"
            :original-label="m.history.thisRevision"
            :modified-label="m.history.latestRevision"
          />
        </div>
      </template>
      <template #footer>
        <div class="flex w-full flex-wrap items-center justify-between gap-2">
          <p class="text-xs text-muted">
            {{
              chosen?.head
                ? m.history.isLatest
                : dirty
                  ? m.history.saveFirst
                  : m.history.restoreHelp
            }}
          </p>
          <UButton
            :label="m.history.restore"
            icon="i-lucide-history"
            :loading="busy"
            :disabled="chosen === null || chosen.head || dirty || chosenMarkdown === ''"
            @click="restore"
          />
        </div>
      </template>
    </UModal>
  </div>
</template>
