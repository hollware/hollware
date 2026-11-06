<script setup lang="ts" generic="T extends TreeRow">
import { computed, ref } from 'vue'
import { useMessages } from '../i18n/index.ts'
import { entryPath } from '../lib/entries.ts'
import {
  buildTree,
  dropZone,
  flatten,
  moveTarget,
  stepTarget,
  type DropZone,
  type MoveTarget,
  type Step,
  type TreeNode,
  type TreeRow,
} from '../lib/entry-tree.ts'

const props = defineProps<{
  rows: readonly T[]
  maxDepth: number
  loading: boolean
  empty: string
  busy: boolean
}>()
const emit = defineEmits<{ move: [entry: T, target: MoveTarget] }>()

const m = useMessages()
const closed = ref(new Set<string>())
const dragged = ref<string | null>(null)
const over = ref<{ slug: string; zone: DropZone } | null>(null)

const tree = computed(() => buildTree(props.rows))
const visible = computed(() => flatten(tree.value, (node) => !closed.value.has(node.entry.slug)))

const ICONS = {
  draft: 'i-lucide-circle-dashed',
  scheduled: 'i-lucide-clock',
  published: 'i-lucide-circle-check',
} as const
const TONES = { draft: 'text-muted', scheduled: 'text-info', published: 'text-success' } as const

function toggle(slug: string) {
  const next = new Set(closed.value)
  if (next.has(slug)) next.delete(slug)
  else next.add(slug)
  closed.value = next
}

function zoneOf(event: DragEvent): DropZone {
  const row = event.currentTarget
  if (!(row instanceof HTMLElement)) return 'inside'
  const box = row.getBoundingClientRect()
  return dropZone(event.clientY - box.top, box.height)
}

function targetOf(slug: string, zone: DropZone): MoveTarget | null {
  return dragged.value === null
    ? null
    : moveTarget(tree.value, dragged.value, slug, zone, props.maxDepth)
}

function onDragStart(event: DragEvent, node: TreeNode<T>) {
  dragged.value = node.entry.slug
  event.dataTransfer?.setData('text/plain', node.entry.slug)
  if (event.dataTransfer !== null) event.dataTransfer.effectAllowed = 'move'
}

function onDragOver(event: DragEvent, node: TreeNode<T>) {
  const zone = zoneOf(event)
  if (targetOf(node.entry.slug, zone) === null) {
    over.value = null
    return
  }
  event.preventDefault()
  over.value = { slug: node.entry.slug, zone }
}

function onDrop(event: DragEvent, node: TreeNode<T>) {
  event.preventDefault()
  const zone = zoneOf(event)
  const target = targetOf(node.entry.slug, zone)
  const moving = props.rows.find((row) => row.slug === dragged.value)
  dragged.value = null
  over.value = null
  if (target !== null && moving !== undefined) emit('move', moving, target)
}

function onDragEnd() {
  dragged.value = null
  over.value = null
}

function steps(node: TreeNode<T>) {
  const item = (step: Step, label: string, icon: string) => {
    const target = stepTarget(tree.value, node.entry.slug, step, props.maxDepth)
    return {
      label,
      icon,
      disabled: target === null || props.busy,
      onSelect: () => {
        if (target !== null) emit('move', node.entry, target)
      },
    }
  }
  return [
    [
      item('up', m.value.entries.tree.moveUp, 'i-lucide-arrow-up'),
      item('down', m.value.entries.tree.moveDown, 'i-lucide-arrow-down'),
      item('indent', m.value.entries.tree.indent, 'i-lucide-indent-increase'),
      item('outdent', m.value.entries.tree.outdent, 'i-lucide-indent-decrease'),
    ],
    [
      {
        label: m.value.entries.tree.addChild,
        icon: 'i-lucide-file-plus',
        disabled: node.depth >= props.maxDepth,
        to: {
          path: '/entries/new',
          query: {
            collection: node.entry.collection,
            locale: node.entry.locale,
            parent: node.entry.slug,
          },
        },
      },
    ],
  ]
}
</script>

<template>
  <div class="pb-24">
    <p v-if="!loading && rows.length === 0" class="px-6 py-10 text-sm text-muted">{{ empty }}</p>
    <ul role="tree" :aria-label="m.entries.tree.label" :aria-busy="busy">
      <li
        v-for="node in visible"
        :key="node.entry.id"
        role="treeitem"
        :aria-level="node.depth"
        :aria-expanded="node.children.length === 0 ? undefined : !closed.has(node.entry.slug)"
        :data-slug="node.entry.slug"
        draggable="true"
        class="group relative flex items-center gap-2 border-b border-default/60 py-2 pe-4 text-sm hover:bg-elevated/50 sm:pe-6"
        :class="{
          'opacity-50': dragged === node.entry.slug,
          'bg-primary/10': over !== null && over.slug === node.entry.slug && over.zone === 'inside',
        }"
        :style="{ paddingInlineStart: `${node.depth * 1.25}rem` }"
        @dragstart="onDragStart($event, node)"
        @dragover="onDragOver($event, node)"
        @dragleave="over = null"
        @drop="onDrop($event, node)"
        @dragend="onDragEnd"
      >
        <span
          v-if="over !== null && over.slug === node.entry.slug && over.zone !== 'inside'"
          aria-hidden="true"
          class="pointer-events-none absolute inset-x-0 h-0.5 bg-primary"
          :class="over?.zone === 'before' ? 'top-0' : 'bottom-0'"
        />
        <UIcon name="i-lucide-grip-vertical" class="size-4 shrink-0 cursor-grab text-dimmed" />
        <UButton
          v-if="node.children.length > 0"
          :icon="closed.has(node.entry.slug) ? 'i-lucide-chevron-right' : 'i-lucide-chevron-down'"
          color="neutral"
          variant="ghost"
          size="xs"
          square
          :aria-label="m.entries.tree.toggle(node.entry.title)"
          @click="toggle(node.entry.slug)"
        />
        <span v-else class="w-6 shrink-0" />
        <span class="sr-only">{{ m.status[node.entry.status] }}</span>
        <UIcon
          :name="ICONS[node.entry.status]"
          :class="['size-4 shrink-0', TONES[node.entry.status]]"
        />
        <RouterLink
          :to="entryPath(node.entry)"
          class="min-w-0 flex-1 truncate font-medium text-highlighted outline-none hover:underline focus-visible:underline"
          >{{ node.entry.title }}</RouterLink
        >
        <span class="hidden truncate font-mono text-xs text-dimmed sm:inline">{{
          node.entry.slug
        }}</span>
        <UDropdownMenu :items="steps(node)">
          <UButton
            icon="i-lucide-ellipsis"
            color="neutral"
            variant="ghost"
            size="xs"
            square
            :aria-label="m.entries.tree.actions(node.entry.title)"
          />
        </UDropdownMenu>
      </li>
    </ul>
  </div>
</template>
