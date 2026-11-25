<script setup lang="ts">
import { useQuery } from '@pinia/colada'
import { computed, defineAsyncComponent } from 'vue'
import { useMessages } from '../i18n/index.ts'
import { entryPath, titleOf } from '../lib/entries.ts'
import { flatValues } from '../lib/frontmatter.ts'
import { operation } from '../lib/queries.ts'

const ReviewPreview = defineAsyncComponent(() => import('./ReviewPreview.vue'))

const props = defineProps<{ collection: string; locale: string; slug: string }>()

const m = useMessages()
const entryQuery = useQuery(() =>
  operation('get_entry', {
    collection: props.collection,
    locale: props.locale,
    slug: props.slug,
    formats: ['document'],
  }),
)
const entry = computed(() => entryQuery.data.value?.entry ?? null)
const values = computed(() =>
  entry.value === null
    ? []
    : flatValues(
        Object.fromEntries(
          Object.entries(entry.value.frontmatter).filter(([key]) => key !== 'title'),
        ),
      ),
)
</script>

<template>
  <div class="h-full min-h-0 overflow-auto">
    <p v-if="entryQuery.isPending.value" class="p-6 text-sm text-muted">{{ m.common.loading }}</p>
    <p v-else-if="entry === null" class="p-6 text-sm text-muted">{{ m.pane.translationGone }}</p>
    <article v-else :lang="locale" class="space-y-6 p-6">
      <header class="space-y-2">
        <div class="flex items-center gap-2">
          <UBadge :label="m.pane.readOnly(locale)" color="neutral" variant="subtle" size="sm" />
          <ULink :to="entryPath(entry)" class="ms-auto text-xs text-muted hover:text-highlighted">{{
            m.pane.openTranslation
          }}</ULink>
        </div>
        <h2 class="text-2xl leading-tight font-semibold text-highlighted">
          {{ titleOf(entry) }}
        </h2>
      </header>
      <section v-if="values.length > 0" aria-labelledby="compare-fields" class="space-y-2">
        <h3 id="compare-fields" class="text-xs font-semibold tracking-wide text-muted uppercase">
          {{ m.pane.fields }}
        </h3>
        <dl class="grid grid-cols-[minmax(0,10rem)_minmax(0,1fr)] gap-x-3 gap-y-1.5 text-sm">
          <template v-for="value in values" :key="value.path.join('.')">
            <dt class="truncate font-mono text-xs text-muted">{{ value.path.join(' › ') }}</dt>
            <dd class="break-words whitespace-pre-wrap">{{ value.text }}</dd>
          </template>
        </dl>
      </section>
      <section aria-labelledby="compare-body" class="space-y-2">
        <h3 id="compare-body" class="text-xs font-semibold tracking-wide text-muted uppercase">
          {{ m.pane.body }}
        </h3>
        <ReviewPreview v-if="entry.document !== undefined" :document="entry.document" />
      </section>
    </article>
  </div>
</template>
