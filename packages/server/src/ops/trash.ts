import { conflictAt, entrySummary } from './answers.ts'
import type { OperationHandler } from './types.ts'

export const deleteEntry: OperationHandler<'delete_entry'> = async (input, context) => {
  const written = await context.store.trashEntry(context.site.key, {
    entryId: input.id,
    expectedVersion: input.version,
  })
  switch (written.outcome) {
    case 'trashed':
      return { outcome: 'trashed', entry: entrySummary(written.view) }
    case 'not_draft':
      return { outcome: 'published', entry: entrySummary(written.view) }
    case 'conflict':
      return {
        outcome: 'conflict',
        conflict: conflictAt(written.currentVersion, written.headRevision),
      }
    case 'not_found':
      return { outcome: 'not_found' }
  }
}

export const restoreEntry: OperationHandler<'restore_entry'> = async (input, context) => {
  const written = await context.store.restoreEntry(context.site.key, input.id)
  switch (written.outcome) {
    case 'restored':
    case 'not_trashed':
      return { outcome: written.outcome, entry: entrySummary(written.view) }
    case 'not_found':
      return { outcome: 'not_found' }
  }
}
