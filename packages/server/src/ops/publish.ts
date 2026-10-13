import { actorOf } from './actor.ts'
import { conflictAt, entrySummary, refusalVerdict, verdictView, violationOf } from './answers.ts'
import { collectionOfEntry } from './collections.ts'
import { judge, processFor, sortKeyOf } from './draft.ts'
import { unexpectedAnswer } from './errors.ts'
import type { OperationHandler } from './types.ts'

/** A warning by what an acknowledgement names: its contract and its path, never its line. */
function warningKey(warning: { readonly contract: string; readonly path: string }): string {
  return JSON.stringify([warning.contract, warning.path])
}

/**
 * Publishes the latest revision of an entry, if it is still at the version the caller read. The
 * contracts run again, in the publish phase, because the rules and the other entries may have
 * changed since the draft was saved: an error blocks, and a warning has to be acknowledged, by
 * contract and path, before the publication is made. The publication records every warning of its
 * verdict as acknowledged (ADR-021).
 */
export const publish: OperationHandler<'publish'> = async (input, context) => {
  const actor = actorOf(context)
  const found = await context.store.findEntryById(context.site.key, input.id, 'head')
  if (found === null) return { outcome: 'not_found' }
  const { entry, revision } = found
  const collection = collectionOfEntry(context.site, entry)
  if (entry.version !== input.version) {
    return { outcome: 'conflict', conflict: conflictAt(entry.version, entry.headRevision) }
  }
  const summary = entrySummary(found)
  // The rules may have changed since the draft was saved, and so may the other entries it points
  // at: check the latest revision again, in the publish phase.
  const processed = await processFor(context.site, collection, revision.markdown)
  if (!processed.ok) {
    return {
      outcome: 'blocked',
      entry: summary,
      verdict: refusalVerdict('publish', processed.violations),
    }
  }
  const verdict = await judge(
    context,
    collection,
    { locale: entry.locale, slug: entry.slug, entryId: entry.id },
    processed.value,
    'publish',
  )
  if (!verdict.ok) return { outcome: 'blocked', entry: summary, verdict: verdictView(verdict) }
  const acknowledged = new Set(input.acknowledgeWarnings.map(warningKey))
  if (verdict.warnings.some((warning) => !acknowledged.has(warningKey(warning)))) {
    return { outcome: 'needs_acknowledgement', entry: summary, verdict: verdictView(verdict) }
  }
  const written = await context.store.publish(context.site.key, {
    entryId: entry.id,
    expectedVersion: input.version,
    verdict,
    // Every warning of the verdict was acknowledged, and the publication records which.
    acknowledged: verdict.warnings.map(({ contract, path }) => ({ contract, path })),
    actor,
    sortKey:
      sortKeyOf(collection, processed.value.frontmatter) ??
      entry.publishedAt ??
      context.clock.now().toISOString(),
  })
  switch (written.outcome) {
    case 'published':
      return {
        outcome: 'published',
        entry: entrySummary(written.view),
        verdict: verdictView(verdict),
      }
    case 'conflict':
      return {
        outcome: 'conflict',
        conflict: conflictAt(written.currentVersion, written.headRevision),
      }
    case 'not_found':
      return { outcome: 'not_found' }
    case 'too_large':
      // The verdict is what made the publication too large to store.
      return {
        outcome: 'blocked',
        entry: summary,
        verdict: refusalVerdict('publish', [violationOf(written, collection)]),
      }
    case 'taken':
      throw unexpectedAnswer(context, 'publish', written)
  }
}
