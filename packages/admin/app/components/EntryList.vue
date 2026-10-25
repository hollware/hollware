<script setup lang="ts" generic="T extends ListRow">
import { defineShortcuts } from '@nuxt/ui/composables'
import { computed, nextTick, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import { formatDateTime, useMessages } from '../i18n/index.ts'
import { entryPath } from '../lib/entries.ts'
import { groupRows, nextIndex, toggled, visibleRows, type ListRow } from '../lib/entry-list.ts'

const props = defineProps<{ rows: readonly T[]; loading: boolean; empty: string }>()
const selected = defineModel<string[]>('selected', { required: true })
defineSlots<{ trailing?(props: { row: T }): unknown; locales?(props: { row: T }): unknown }>()

const m = useMessages()
const router = useRouter()
const folded = ref(new Set<string>())
const focused = ref(-1)
const list = ref<HTMLElement | null>(null)

const groups = computed(() => groupRows(props.rows))
const visible = computed(() => visibleRows(groups.value, folded.value))

const ICONS = {
  draft: 'i-lucide-circle-dashed',
  scheduled: 'i-lucide-clock',
  published: 'i-lucide-circle-check',
  trash: 'i-lucide-trash-2',
} as const
const TONES = {
  draft: 'text-muted',
  scheduled: 'text-info',
  published: 'text-success',
  trash: 'text-dimmed',
} as const

function label(key: keyof typeof ICONS): string {
  return {
    draft: m.value.entries.views.drafts,
    scheduled: m.value.entries.views.scheduled,
    published: m.value.entries.views.published,
    trash: m.value.entries.views.trash,
  }[key]
}

function fold(key: string) {
  const next = new Set(folded.value)
  if (next.has(key)) next.delete(key)
  else next.add(key)
  folded.value = next
}

watch(
  () => props.rows,
  () => {
    const ids = new Set(props.rows.map((row) => row.id))
    selected.value = selected.value.filter((id) => ids.has(id))
    if (focused.value >= visible.value.length) focused.value = visible.value.length - 1
  },
)

async function focusRow(index: number) {
  focused.value = index
  await nextTick()
  list.value
    ?.querySelector<HTMLElement>(`[data-index="${index}"] a, [data-index="${index}"] [data-title]`)
    ?.focus()
}

function move(step: 1 | -1) {
  void focusRow(nextIndex(focused.value, visible.value.length, step))
}

function current(): T | undefined {
  return visible.value[focused.value]
}

defineShortcuts({
  j: () => move(1),
  k: () => move(-1),
  arrowdown: () => move(1),
  arrowup: () => move(-1),
  x: () => {
    const row = current()
    if (row !== undefined) selected.value = toggled(selected.value, row.id)
  },
  escape: () => {
    selected.value = []
  },
})

function open(row: T) {
  if (row.deletedAt === null) void router.push(entryPath(row))
}
</script>

<template>
  <div ref="list" class="pb-24">
    <p v-if="!loading && rows.length === 0" class="px-6 py-10 text-sm text-muted">{{ empty }}</p>
    <section v-for="group in groups" :key="group.key" :aria-label="label(group.key)">
      <h2
        class="sticky top-0 z-10 flex items-center gap-2 border-b border-default bg-elevated/70 px-4 py-1.5 text-xs font-medium text-toned backdrop-blur sm:px-6"
      >
        <UButton
          :icon="folded.has(group.key) ? 'i-lucide-chevron-right' : 'i-lucide-chevron-down'"
          color="neutral"
          variant="ghost"
          size="xs"
          square
          :aria-label="label(group.key)"
          :aria-expanded="!folded.has(group.key)"
          @click="fold(group.key)"
        />
        <UIcon :name="ICONS[group.key]" :class="['size-3.5', TONES[group.key]]" />
        <span>{{ label(group.key) }}</span>
        <span class="text-muted">{{ group.rows.length }}</span>
      </h2>
      <ul v-if="!folded.has(group.key)" role="list">
        <li
          v-for="row in group.rows"
          :key="row.id"
          :aria-label="row.title"
          :data-index="visible.indexOf(row)"
          class="group flex items-center gap-3 border-b border-default/60 px-4 py-2 text-sm hover:bg-elevated/50 sm:px-6"
          :class="{
            'bg-elevated/60': visible.indexOf(row) === focused,
            'bg-secondary/5': selected.includes(row.id),
          }"
          @click.self="open(row)"
        >
          <UCheckbox
            :model-value="selected.includes(row.id)"
            :aria-label="m.table.selectRow(row.title)"
            class="transition-opacity"
            :class="
              selected.length > 0 || selected.includes(row.id)
                ? 'opacity-100'
                : 'opacity-0 group-hover:opacity-100 focus-within:opacity-100'
            "
            @update:model-value="selected = toggled(selected, row.id)"
          />
          <span class="sr-only">{{
            row.deletedAt === null ? m.status[row.status] : m.entries.trash
          }}</span>
          <UIcon
            :name="ICONS[row.deletedAt === null ? row.status : 'trash']"
            :class="['size-4 shrink-0', TONES[row.deletedAt === null ? row.status : 'trash']]"
          />
          <div class="flex min-w-0 flex-1 items-baseline gap-2" @click="open(row)">
            <RouterLink
              v-if="row.deletedAt === null"
              :to="entryPath(row)"
              class="truncate font-medium text-highlighted outline-none hover:underline focus-visible:underline"
              @focus="focused = visible.indexOf(row)"
              >{{ row.title }}</RouterLink
            >
            <span v-else data-title tabindex="-1" class="truncate font-medium text-highlighted">{{
              row.title
            }}</span>
            <span class="hidden truncate font-mono text-xs text-muted md:inline">{{
              row.slug
            }}</span>
          </div>
          <UBadge
            v-if="row.status === 'published' && row.hasUnpublishedChanges"
            :label="m.entries.changes"
            color="warning"
            variant="subtle"
            size="sm"
          />
          <UBadge
            v-if="row.translationOutdated === true"
            :label="m.entries.behind"
            color="warning"
            variant="subtle"
            size="sm"
            icon="i-lucide-languages"
          />
          <span v-if="row.scheduledAt !== null" class="hidden text-xs text-info sm:inline">{{
            formatDateTime(row.scheduledAt)
          }}</span>
          <span class="flex items-center gap-1 font-mono text-xs text-muted">
            <span>{{ row.locale }}</span>
            <slot name="locales" :row="row" />
          </span>
          <span class="hidden w-36 text-right text-xs text-muted lg:inline">{{
            formatDateTime(row.updatedAt)
          }}</span>
          <slot name="trailing" :row="row" />
        </li>
      </ul>
    </section>
  </div>
</template>
