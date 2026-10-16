import UButton from '@nuxt/ui/components/Button.vue'
import type { Column } from '@tanstack/vue-table'
import { h } from 'vue'

/**
 * The header of a column of a table that sorts: its label as a button that sorts it up, then
 * down, with an arrow that says which, as Nuxt UI's tables do.
 */
export function sortable<Row>(label: string) {
  return ({ column }: { column: Column<Row> }) => {
    const sorted = column.getIsSorted()
    return h(UButton, {
      color: 'neutral',
      variant: 'ghost',
      label,
      icon:
        sorted === 'asc'
          ? 'i-lucide-arrow-up-narrow-wide'
          : sorted === 'desc'
            ? 'i-lucide-arrow-down-wide-narrow'
            : 'i-lucide-arrow-up-down',
      class: '-mx-2.5',
      'aria-label': `Sort by ${label.toLowerCase()}`,
      onClick: () => column.toggleSorting(sorted === 'asc'),
    })
  }
}
