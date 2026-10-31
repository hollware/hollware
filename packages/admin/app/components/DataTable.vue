<script setup lang="ts" generic="Row extends Record<string, unknown>">
import type { TableColumn } from '@nuxt/ui'
import UCheckbox from '@nuxt/ui/components/Checkbox.vue'
import {
  getPaginationRowModel,
  type RowSelectionState,
  type SortingState,
  type Table,
} from '@tanstack/vue-table'
import { computed, h, ref, useTemplateRef, watch } from 'vue'
import { useMessages } from '../i18n/index.ts'
import { pageRange } from '../lib/table.ts'

const props = withDefaults(
  defineProps<{
    data: readonly Row[]
    columns: TableColumn<Row>[]
    filterLabel?: string
    pageSize?: number
    loading?: boolean
    empty?: string
    selectable?: boolean
    rowKey?: (row: Row) => string
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

const table = useTemplateRef<{ tableApi: Table<Row> | undefined }>('table')
const filter = ref('')
const sorting = ref<SortingState>([])
const pagination = ref({ pageIndex: 0, pageSize: props.pageSize })

const api = computed(() => table.value?.tableApi)
const rows = computed(() => [...props.data])
function countLeftByFilter(all: number, text: string): number {
  return api.value === undefined || text === '' ? all : api.value.getFilteredRowModel().rows.length
}
const filtered = computed(() => countLeftByFilter(rows.value.length, filter.value))
const range = computed(() =>
  pageRange(pagination.value.pageIndex, pagination.value.pageSize, filtered.value),
)
watch(filter, () => {
  pagination.value = { ...pagination.value, pageIndex: 0 }
})

const selection = ref<RowSelectionState>({})
const selected = computed(() => props.data.filter((row) => selection.value[props.rowKey(row)]))
function clear() {
  selection.value = {}
}
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
              'onUpdate:modelValue': (value: unknown) =>
                api.toggleAllPageRowsSelected(value === true),
              'aria-label': m.value.table.selectPage,
            }),
          cell: ({ row }) =>
            h(UCheckbox, {
              modelValue: row.getIsSelected(),
              'onUpdate:modelValue': (value: unknown) => row.toggleSelected(value === true),
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
      <span class="tabular-nums">{{
        m.table.count(range.from, range.to, filtered, data.length)
      }}</span>
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
