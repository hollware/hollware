import { actorOf } from './actor.ts'
import { conflictAt, entrySummary, refusalVerdict, verdictView, violationOf } from './answers.ts'
import { collectionOfEntry } from './collections.ts'
import { judge, processFor, revisionOf, translationGroupOf } from './draft.ts'
import type { OperationHandler } from './types.ts'

/**
 * Saves a new revision of an entry, if it is still at the version the caller read. The version is
 * checked before anything else, so that a caller that is behind learns where the entry is now and
 * is not told what its file would have been. The file that the head already holds is `unchanged`:
 * no revision and no version, which is what makes importing the same files twice a no-op.
 */
export const updateDraft: OperationHandler<'update_draft'> = async (input, context) => {
  const actor = actorOf(context)
  const found = await context.store.findEntryById(context.site.key, input.id, 'head')
  if (found === null) return { outcome: 'not_found' }
  const { entry, revision } = found
  const collection = collectionOfEntry(context.site, entry)
  // A change against another version than the entry's is a conflict, whatever it says.
  if (entry.version !== input.version) {
    return { outcome: 'conflict', conflict: conflictAt(entry.version, entry.headRevision) }
  }
  // The same file again is no change: no revision and no version, which makes an import idempotent.
  if (input.markdown === revision.markdown) {
    return {
      outcome: 'unchanged',
      entry: entrySummary(found),
      verdict: verdictView(revision.verdict),
    }
  }
  const processed = await processFor(context.site, collection, input.markdown)
  if (!processed.ok) {
    return { outcome: 'refused', verdict: refusalVerdict('write', processed.violations) }
  }
  const verdict = await judge(
    context,
    collection,
    { locale: entry.locale, slug: entry.slug, entryId: entry.id },
    processed.value,
    'write',
  )
  const written = await context.store.appendRevision(context.site.key, {
    entryId: entry.id,
    expectedVersion: input.version,
    translationGroup: translationGroupOf(collection, processed.value.frontmatter),
    revision: revisionOf({
      markdown: input.markdown,
      processed: processed.value,
      collection,
      verdict,
      actor,
    }),
  })
  switch (written.outcome) {
    case 'saved':
      return { outcome: 'saved', entry: entrySummary(written.view), verdict: verdictView(verdict) }
    case 'conflict':
      // Another write got in between the read and this one: the store's check is the one that counts.
      return {
        outcome: 'conflict',
        conflict: conflictAt(written.currentVersion, written.headRevision),
      }
    case 'not_found':
      return { outcome: 'not_found' }
    case 'taken':
    case 'too_large':
      return {
        outcome: 'refused',
        verdict: refusalVerdict('write', [violationOf(written, collection)]),
      }
  }
}
