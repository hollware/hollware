<script setup lang="ts" generic="Row extends Record<string, unknown>">
import type { TableColumn } from '@nuxt/ui'
import { getPaginationRowModel, type SortingState } from '@tanstack/vue-table'
import { computed, ref, useTemplateRef } from 'vue'
import { useMessages } from '../i18n/index.ts'

/**
 * Every table of the admin: Nuxt UI's table with a filter over every column, columns that sort,
 * and pages. A cell is a slot of the page that uses it (`#title-cell="{ row }"`), and the filters
 * of its own go in `#filters`, beside the text filter.
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
  }>(),
  { filterLabel: undefined, pageSize: 25, loading: false, empty: undefined },
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
    <UTable
      ref="table"
      v-model:global-filter="filter"
      v-model:sorting="sorting"
      v-model:pagination="pagination"
      :data="rows"
      :columns="columns"
      :loading="loading"
      :empty="empty ?? m.table.empty"
      :pagination-options="{ getPaginationRowModel: getPaginationRowModel() }"
      class="rounded-lg border border-default"
    >
      <template v-for="(_, name) in $slots" #[name]="slotProps" :key="name">
        <slot v-if="name !== 'filters'" :name="name" v-bind="slotProps ?? {}" />
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
