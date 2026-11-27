<script setup lang="ts">
import type { DropdownMenuItem } from '@nuxt/ui'
import type { JSONContent } from '@tiptap/core'
import type { Transaction } from '@tiptap/pm/state'
import { NodeViewContent, NodeViewWrapper, nodeViewProps } from '@tiptap/vue-3'
import { computed, inject, ref } from 'vue'
import { useMessages } from '../../i18n/index.ts'
import {
  COMPONENT_CONTENT_KEY,
  componentContent,
  COMPONENTS_KEY,
  propForm,
  propProblems,
  writeProps,
  type PropProblem,
  type PropValue,
} from '../../lib/editor/components.ts'
import {
  addChild,
  deleteNode,
  duplicateNode,
  insertInside,
  moveNode,
  repeatedChild,
} from '../../lib/editor/tree.ts'
import ComponentPicker from './ComponentPicker.vue'
import ImagePicker from './ImagePicker.vue'
import PropForm from './PropForm.vue'

const props = defineProps(nodeViewProps)
const m = useMessages()
const definitions = inject(COMPONENTS_KEY, ref([]))
const contents = inject(COMPONENT_CONTENT_KEY, ref<Record<string, JSONContent>>({}))

const name = computed(() => String(props.node.attrs['name'] ?? ''))
const definition = computed(() => definitions.value.find((known) => known.name === name.value))
const form = computed(() => propForm(props.node.attrs['props'], definition.value?.props ?? null))
const shown = computed(() =>
  form.value.fields.flatMap((field) => {
    const value = form.value.values[field.name]
    return value === null || value === undefined ? [] : [`${field.name}=${String(value)}`]
  }),
)
const editable = computed(() => props.editor.isEditable)
const menuOpened = ref(0)
const place = computed(() => {
  void props.node
  void menuOpened.value
  const pos = props.getPos()
  if (typeof pos !== 'number') return null
  const $pos = props.editor.state.doc.resolve(pos)
  return {
    first: $pos.index() === 0,
    last: $pos.index() === $pos.parent.childCount - 1,
  }
})
const child = computed(() => repeatedChild(props.node))

const open = ref(false)
const picking = ref<string | null>(null)
const values = ref<Record<string, PropValue>>({})
const problems = ref<Record<string, PropProblem>>({})

function toggle(isOpen: boolean) {
  if (isOpen && picking.value === null) {
    values.value = { ...form.value.values }
    problems.value = {}
  }
  open.value = isOpen
}

function apply() {
  problems.value = propProblems(form.value.fields, values.value)
  if (Object.keys(problems.value).length > 0) return
  props.updateAttributes({ props: writeProps(props.node.attrs['props'], form.value, values.value) })
  open.value = false
}

const pickerOpen = computed({
  get: () => picking.value !== null,
  set: (isOpen: boolean) => {
    if (!isOpen) picking.value = null
  },
})

function pick(image: { src: string }) {
  if (picking.value !== null) values.value = { ...values.value, [picking.value]: image.src }
  picking.value = null
}

function run(change: (tr: Transaction, pos: number) => boolean) {
  const pos = props.getPos()
  if (typeof pos !== 'number') return
  props.editor
    .chain()
    .focus()
    .command(({ tr }) => change(tr, pos))
    .run()
}

const choosing = ref(false)

function insertChosen(component: string) {
  run((tr, pos) => insertInside(tr, pos, contentOf(component)))
}

function contentOf(component: string) {
  return contents.value[component] ?? componentContent(component, [])
}

const menu = computed<DropdownMenuItem[][]>(() => {
  const adding: DropdownMenuItem[] = []
  if (child.value !== null) {
    const repeated = child.value
    adding.push({
      label: m.value.editor.component.addChild(repeated),
      icon: 'i-lucide-plus',
      onSelect: () => run((tr, pos) => addChild(tr, pos, contentOf(repeated))),
    })
  }
  if (definitions.value.length > 0) {
    adding.push({
      label: m.value.editor.component.insertInside,
      icon: 'i-lucide-square-plus',
      onSelect: () => {
        choosing.value = true
      },
    })
  }
  return [
    adding,
    [
      {
        label: m.value.editor.block.duplicate,
        icon: 'i-lucide-copy',
        kbds: ['meta', 'shift', 'd'],
        onSelect: () => run(duplicateNode),
      },
      {
        label: m.value.editor.block.moveUp,
        icon: 'i-lucide-arrow-up',
        kbds: ['meta', 'shift', 'arrowup'],
        disabled: place.value?.first ?? true,
        onSelect: () => run((tr, pos) => moveNode(tr, pos, -1)),
      },
      {
        label: m.value.editor.block.moveDown,
        icon: 'i-lucide-arrow-down',
        kbds: ['meta', 'shift', 'arrowdown'],
        disabled: place.value?.last ?? true,
        onSelect: () => run((tr, pos) => moveNode(tr, pos, 1)),
      },
    ],
    [
      {
        label: m.value.editor.block.delete,
        icon: 'i-lucide-trash-2',
        color: 'error',
        onSelect: () => run(deleteNode),
      },
    ],
  ].filter((group) => group.length > 0)
})
</script>

<template>
  <NodeViewWrapper
    as="section"
    class="hw-component my-3 rounded-lg border border-default bg-elevated/40"
    :aria-label="m.editor.componentNamed(name)"
  >
    <header
      contenteditable="false"
      class="flex items-center gap-2 border-b border-default px-3 py-1.5 text-xs text-muted"
    >
      <UIcon name="i-lucide-puzzle" class="size-3.5 shrink-0 text-secondary" />
      <UTooltip :text="definition?.description ?? undefined" :disabled="!definition?.description">
        <span class="font-mono font-medium text-highlighted">{{ name }}</span>
      </UTooltip>
      <UBadge
        v-if="definition === undefined"
        :label="m.editor.component.unknown"
        color="error"
        variant="subtle"
        size="sm"
      />
      <span class="min-w-0 truncate font-mono">{{ shown.join(' ') }}</span>
      <UPopover
        :open="open"
        :dismissible="picking === null"
        :content="{ align: 'end' }"
        @update:open="toggle"
      >
        <UButton
          :label="m.editor.component.props"
          icon="i-lucide-sliders-horizontal"
          size="xs"
          variant="ghost"
          color="neutral"
          class="ms-auto shrink-0"
          :disabled="!editable"
        />
        <template #content>
          <form class="max-h-[70vh] w-80 space-y-3 overflow-y-auto p-3" @submit.prevent="apply">
            <p v-if="definition?.description" class="text-sm text-toned">
              {{ definition.description }}
            </p>
            <p v-if="form.fields.length === 0" class="text-sm text-muted">
              {{ m.editor.component.noProps }}
            </p>
            <PropForm
              v-model:values="values"
              :fields="form.fields"
              :problems="problems"
              @pick-image="(field: string) => (picking = field)"
            />
            <UButton
              v-if="form.fields.length > 0"
              type="submit"
              :label="m.editor.apply"
              size="sm"
            />
          </form>
        </template>
      </UPopover>
      <UDropdownMenu
        v-if="editable"
        :items="menu"
        :content="{ align: 'end' }"
        @update:open="menuOpened++"
      >
        <UButton
          icon="i-lucide-ellipsis"
          size="xs"
          variant="ghost"
          color="neutral"
          class="shrink-0"
          :aria-label="m.editor.component.actions(name)"
        />
      </UDropdownMenu>
    </header>
    <NodeViewContent class="px-4 py-2" />
    <ImagePicker v-model:open="pickerOpen" @pick="pick" />
    <ComponentPicker
      v-model:open="choosing"
      :definitions="definitions"
      :title="m.editor.component.insertInsideNamed(name)"
      @pick="insertChosen"
    />
  </NodeViewWrapper>
</template>
