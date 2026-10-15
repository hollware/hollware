<script setup lang="ts">
import { useToast } from '@nuxt/ui/composables'
import { computed, onMounted, ref, watch } from 'vue'
import MarkdownEditor from '../components/MarkdownEditor.vue'
import VerdictList from '../components/VerdictList.vue'
import { ApiError, type Output } from '../lib/api.ts'
import { diagnosticsOf } from '../lib/diagnostics.ts'
import { api } from '../lib/session.ts'

const props = defineProps<{ collection: string; locale: string; slug: string }>()

type Entry = NonNullable<Output<'get_entry'>['entry']>
type Verdict = Output<'validate'>['verdict']
type Warning = Verdict['warnings'][number]

const toast = useToast()
const entry = ref<Entry | null>(null)
const missing = ref(false)
const text = ref('')
/** The Markdown as it was last loaded or saved: what tells an unsaved change. */
const saved = ref('')
const verdict = ref<Verdict | null>(null)
const busy = ref(false)
const conflictOpen = ref(false)
const warnings = ref<Warning[]>([])
const acknowledgeOpen = ref(false)

const ref_ = computed(() => ({
  collection: props.collection,
  locale: props.locale,
  slug: props.slug,
}))
const dirty = computed(() => text.value !== saved.value)
const diagnostics = computed(() =>
  verdict.value === null ? [] : diagnosticsOf(text.value, verdict.value),
)

async function load() {
  const read = await api.call('get_entry', { ...ref_.value, formats: ['markdown', 'html'] })
  if (read.outcome === 'not_found' || read.entry === undefined) {
    missing.value = true
    return
  }
  entry.value = read.entry
  text.value = read.entry.markdown ?? ''
  saved.value = text.value
  verdict.value = read.entry.verdict
}

onMounted(load)

// The contracts run again a moment after the person stops typing, without saving anything.
let timer: ReturnType<typeof setTimeout> | undefined
watch(text, (markdown) => {
  clearTimeout(timer)
  timer = setTimeout(async () => {
    verdict.value = (await api.call('validate', { ...ref_.value, markdown })).verdict
  }, 600)
})

function report(error: unknown, title: string) {
  const description = error instanceof ApiError ? `${error.message} ${error.fix}` : String(error)
  toast.add({ title, description, color: 'error' })
}

async function save() {
  if (entry.value === null) return
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

async function publish(acknowledged: readonly Warning[] = []) {
  if (entry.value === null) return
  busy.value = true
  acknowledgeOpen.value = false
  try {
    const answer = await api.call('publish', {
      id: entry.value.id,
      version: entry.value.version,
      acknowledgeWarnings: acknowledged.map(({ contract, path }) => ({ contract, path })),
    })
    switch (answer.outcome) {
      case 'published':
        await load()
        toast.add({ title: 'Published', color: 'success' })
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
        acknowledgeOpen.value = true
        break
      case 'blocked':
        verdict.value = answer.verdict ?? verdict.value
        toast.add({ title: 'Blocked', description: 'Fix the errors first.', color: 'error' })
        break
      case 'conflict':
        conflictOpen.value = true
        break
      case 'scheduled':
      case 'not_found':
        await load()
        break
    }
  } catch (error) {
    report(error, 'Not published')
  } finally {
    busy.value = false
  }
}

async function reloadTheirs() {
  conflictOpen.value = false
  await load()
}
</script>

<template>
  <p v-if="missing" class="text-muted">There is no such entry.</p>
  <div v-else-if="entry !== null" class="space-y-4">
    <div class="flex flex-wrap items-center gap-3">
      <h1 class="text-xl font-semibold">{{ entry.frontmatter['title'] ?? entry.slug }}</h1>
      <UBadge :label="entry.status" variant="subtle" />
      <span class="text-sm text-muted">v{{ entry.version }} · {{ entry.locale }}</span>
      <div class="ml-auto flex gap-2">
        <UButton label="Save" :loading="busy" :disabled="!dirty" @click="save" />
        <UButton
          label="Publish"
          color="success"
          :loading="busy"
          :disabled="dirty || (!entry.hasUnpublishedChanges && entry.status === 'published')"
          @click="publish()"
        />
      </div>
    </div>
    <div class="grid gap-4 lg:grid-cols-2">
      <MarkdownEditor v-model="text" :diagnostics="diagnostics" />
      <div class="space-y-4">
        <VerdictList :verdict="verdict" />
        <section
          aria-label="Preview of the saved revision"
          class="prose max-w-none rounded border border-default p-4"
        >
          <!-- The HTML that Hollware renders from Comark, which escapes what it does not know. -->
          <div v-html="entry.html ?? ''" />
        </section>
      </div>
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
        <UButton label="Publish anyway" color="warning" @click="publish(warnings)" />
      </template>
    </UModal>
  </div>
  <p v-else class="text-muted">Loading…</p>
</template>
