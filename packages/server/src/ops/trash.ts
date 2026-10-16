import { conflictAt, entrySummary } from './answers.ts'
import type { OperationHandler } from './types.ts'

/**
 * The trash of entries. Only a draft goes there: a published or scheduled entry is unpublished
 * first. Nothing is deleted, since revisions, tags and publications are append-only (ADR-021): the
 * entry gets its `deletedAt`, every read leaves it out, and it keeps its slug and translation
 * until it is restored as the draft it was.
 */

/**
 * Moves a draft to the trash, if it is still at the version the caller read. The store checks it
 * all in the write: an entry that is not there (or is in the trash already) is `not_found`, another
 * version is `conflict`, and what is published or scheduled is taken off the site first.
 */
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

/** Brings an entry back from the trash as the draft it was. */
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
