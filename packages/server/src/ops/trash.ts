import { conflictAt, entrySummary } from './answers.ts'
import { childrenView, treeOf } from './tree.ts'
import type { OperationHandler } from './types.ts'

export const deleteEntry: OperationHandler<'delete_entry'> = async (input, context) => {
  const found = await context.store.findEntryById(context.site.key, input.id, 'head')
  const written = await context.store.trashEntry(context.site.key, {
    entryId: input.id,
    expectedVersion: input.version,
    tree: found === null ? null : treeOf(context.site, found.entry.collection, found.entry.locale),
  })
  switch (written.outcome) {
    case 'trashed':
      return { outcome: 'trashed', entry: entrySummary(written.view) }
    case 'not_draft':
      return { outcome: 'published', entry: entrySummary(written.view) }
    case 'has_children':
      return {
        outcome: 'has_children',
        entry: entrySummary(written.view),
        children: await childrenView(context, written.view.entry, 'head'),
      }
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
  const written = await context.store.restoreEntry(context.site.key, input.id, (ref) =>
    treeOf(context.site, ref.collection, ref.locale),
  )
  switch (written.outcome) {
    case 'restored':
    case 'not_trashed':
    case 'parent_in_trash':
      return { outcome: written.outcome, entry: entrySummary(written.view) }
    case 'not_found':
      return { outcome: 'not_found' }
  }
}
