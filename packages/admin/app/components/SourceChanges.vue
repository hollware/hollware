<script setup lang="ts">
import { ref } from 'vue'
import DiffView from './DiffView.vue'
import type { Output } from '../lib/api.ts'
import { entryPath } from '../lib/entries.ts'
import { formatDateTime, useMessages } from '../i18n/index.ts'
import { api } from '../lib/session.ts'
import { sourceWhenTranslated } from '../lib/translations.ts'

const props = defineProps<{
  source: { id: string; collection: string; locale: string; slug: string }
  revision: string
}>()

type Revision = NonNullable<Output<'list_revisions'>['revisions']>[number]

const m = useMessages()
const open = ref(false)
const loading = ref(false)
const translatedAt = ref<string | null>(null)
const before = ref('')
const now = ref('')

async function markdownOf(id: string): Promise<string> {
  return (await api.call('get_revision', { id })).revision?.markdown ?? ''
}

async function show() {
  open.value = true
  loading.value = true
  try {
    const own = (await api.call('get_revision', { id: props.revision })).revision
    translatedAt.value = own?.createdAt ?? null
    const seen: Revision[] = []
    let cursor: string | null = null
    let base: Revision | undefined
    do {
      const page: Output<'list_revisions'> = await api.call('list_revisions', {
        id: props.source.id,
        limit: 50,
        ...(cursor === null ? {} : { cursor }),
      })
      seen.push(...(page.revisions ?? []))
      cursor = page.nextCursor ?? null
      base =
        translatedAt.value === null ? undefined : sourceWhenTranslated(seen, translatedAt.value)
    } while (base === undefined && cursor !== null)
    const head = seen.find((revision) => revision.head) ?? seen[0]
    ;[before.value, now.value] = await Promise.all([
      base === undefined ? '' : markdownOf(base.id),
      head === undefined ? '' : markdownOf(head.id),
    ])
  } finally {
    loading.value = false
  }
}
</script>

<template>
  <UButton
    :label="m.entry.sourceChanges"
    icon="i-lucide-git-compare"
    size="xs"
    variant="ghost"
    @click="show"
  />
  <UModal
    v-model:open="open"
    :title="m.entry.sourceChangesTitle(source.locale)"
    :ui="{ content: 'sm:max-w-5xl' }"
  >
    <template #body>
      <div class="space-y-3">
        <p class="text-muted">
          {{
            translatedAt === null
              ? m.common.loading
              : m.entry.sourceChangesSince(formatDateTime(translatedAt))
          }}
        </p>
        <p v-if="loading" class="text-sm text-muted">{{ m.common.loading }}</p>
        <DiffView
          v-else
          :original="before"
          :modified="now"
          :original-label="m.entry.sourceThen"
          :modified-label="m.entry.sourceNow"
        />
      </div>
    </template>
    <template #footer>
      <UButton
        :to="entryPath(source)"
        :label="m.entry.openSource(source.locale)"
        icon="i-lucide-arrow-right"
        variant="outline"
        color="neutral"
        @click="open = false"
      />
    </template>
  </UModal>
</template>
