<script setup lang="ts" generic="Row extends Record<string, unknown>">
import type { TableColumn } from '@nuxt/ui'
import UCheckbox from '@nuxt/ui/components/Checkbox.vue'
import {
  getPaginationRowModel,
  type RowSelectionState,
  type SortingState,
} from '@tanstack/vue-table'
import { computed, h, ref, useTemplateRef, watch } from 'vue'
import { useMessages } from '../i18n/index.ts'

/**
 * Every table of the admin: Nuxt UI's table with a filter over every column, columns that sort,
 * and pages. A cell is a slot of the page that uses it (`#title-cell="{ row }"`), and the filters
 * of its own go in `#filters`, beside the text filter.
 *
 * A table whose rows can be acted on together is `selectable`: a column of checkboxes (the one of
 * its header takes the rows of the page), and, once a row is chosen, a bar with how many and the
 * actions of the page, its `#bulk="{ selected, clear }"` slot.
 */
const props = withDefaults(
  defineProps<{
    data: readonly Row[]
    columns: TableColumn<Row>[]
    /** What the text filter is for, as its placeholder and its label. */
    filterLabel?: string
    pageSize?: number
    loading?: boolean
    empty?: string
    selectable?: boolean
    /** The key of a row, which a selection is kept by: its `id` unless said otherwise. */
    rowKey?: (row: Row) => string
    /** What a row is called, for the label of its checkbox. */
    rowLabel?: (row: Row) => string
  }>(),
  {
    filterLabel: undefined,
    pageSize: 25,
    loading: false,
    empty: undefined,
    selectable: false,
    rowKey: (row: Record<string, unknown>) => String(row['id']),
    rowLabel: undefined,
  },
)

const m = useMessages()
const filterText = computed(() => props.filterLabel ?? m.value.table.filter)

const table = useTemplateRef('table')
const filter = ref('')
const sorting = ref<SortingState>([])
const pagination = ref({ pageIndex: 0, pageSize: props.pageSize })

const api = computed(() => table.value?.tableApi)
const filtered = computed(() => api.value?.getFilteredRowModel().rows.length ?? props.data.length)
const rows = computed(() => [...props.data])

const selection = ref<RowSelectionState>({})
/** The chosen rows, in the order of the data. */
const selected = computed(() => props.data.filter((row) => selection.value[props.rowKey(row)]))
function clear() {
  selection.value = {}
}
// A row that leaves the data leaves the selection: what is chosen is always on the table.
watch(
  () => props.data,
  (data) => {
    const keys = new Set(data.map(props.rowKey))
    selection.value = Object.fromEntries(
      Object.entries(selection.value).filter(([key, chosen]) => chosen && keys.has(key)),
    )
  },
)

const allColumns = computed<TableColumn<Row>[]>(() =>
  props.selectable
    ? [
        {
          id: 'select',
          header: ({ table: api }) =>
            h(UCheckbox, {
              modelValue: api.getIsSomePageRowsSelected()
                ? 'indeterminate'
                : api.getIsAllPageRowsSelected(),
              'onUpdate:modelValue': (value: boolean | 'indeterminate') =>
                api.toggleAllPageRowsSelected(value === true),
              'aria-label': m.value.table.selectPage,
            }),
          cell: ({ row }) =>
            h(UCheckbox, {
              modelValue: row.getIsSelected(),
              'onUpdate:modelValue': (value: boolean | 'indeterminate') =>
                row.toggleSelected(value === true),
              'aria-label': m.value.table.selectRow(
                props.rowLabel?.(row.original) ?? props.rowKey(row.original),
              ),
            }),
          enableSorting: false,
          enableGlobalFilter: false,
        },
        ...props.columns,
      ]
    : props.columns,
)
</script>

<template>
  <div class="space-y-3">
    <div class="flex flex-wrap items-center gap-2">
      <slot name="filters" />
      <UInput
        v-model="filter"
        icon="i-lucide-search"
        :placeholder="filterText"
        :aria-label="filterText"
        class="min-w-0 flex-1 basis-56"
      />
    </div>
    <div
      v-if="selected.length > 0"
      role="toolbar"
      :aria-label="m.table.bulk"
      class="flex flex-wrap items-center gap-2 rounded-lg border border-default bg-elevated px-3 py-2"
    >
      <span class="text-sm font-medium tabular-nums">{{ m.table.selected(selected.length) }}</span>
      <USeparator orientation="vertical" class="h-5" />
      <slot name="bulk" :selected="selected" :clear="clear" />
      <UButton
        :label="m.table.clear"
        icon="i-lucide-x"
        color="neutral"
        variant="ghost"
        size="sm"
        class="ml-auto"
        @click="clear"
      />
    </div>
    <UTable
      ref="table"
      v-model:global-filter="filter"
      v-model:sorting="sorting"
      v-model:pagination="pagination"
      v-model:row-selection="selection"
      :get-row-id="(row: Row) => rowKey(row)"
      :data="rows"
      :columns="allColumns"
      :loading="loading"
      :empty="empty ?? m.table.empty"
      :pagination-options="{ getPaginationRowModel: getPaginationRowModel() }"
      class="rounded-lg border border-default"
    >
      <template v-for="(_, name) in $slots" #[name]="slotProps" :key="name">
        <slot v-if="name !== 'filters' && name !== 'bulk'" :name="name" v-bind="slotProps ?? {}" />
      </template>
    </UTable>
    <div class="flex flex-wrap items-center justify-between gap-3 text-sm text-muted">
      <span class="tabular-nums">{{ m.table.count(filtered, data.length) }}</span>
      <UPagination
        v-if="filtered > pagination.pageSize"
        :page="pagination.pageIndex + 1"
        :items-per-page="pagination.pageSize"
        :total="filtered"
        @update:page="(page: number) => api?.setPageIndex(page - 1)"
      />
    </div>
  </div>
</template>
