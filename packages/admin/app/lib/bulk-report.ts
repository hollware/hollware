import { useToast } from '@nuxt/ui/composables/useToast'
import { useMessages } from '../i18n/index.ts'
import { summaryOf } from './bulk.ts'

const DONE = new Set([
  'published',
  'scheduled',
  'pending_review',
  'unpublished',
  'changes_requested',
  'revoked',
  'removed',
  'changed',
  'trashed',
  'restored',
  'purged',
])

export function useBulkReport() {
  const toast = useToast()
  const m = useMessages()
  return (counts: ReadonlyMap<string, number>) => {
    const clean = [...counts.keys()].every((outcome) => DONE.has(outcome))
    toast.add({
      title: clean ? m.value.bulk.done : m.value.bulk.partly,
      description: summaryOf(counts, m.value.bulk.outcomes),
      color: clean ? 'success' : 'warning',
    })
  }
}
