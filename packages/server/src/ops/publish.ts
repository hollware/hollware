import type { EntryLookup, Verdict } from '@hollware/core'
import type { PublishWrite } from '../ports.ts'
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
  if (input.group.length > 0) return publishGroup(input, context)
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

/** The lookup of the contracts, with the entries of a group seen as published (ADR-024). */
function asPublished(lookup: EntryLookup, ids: ReadonlySet<string>): EntryLookup {
  return {
    lookupMany: async (refs) =>
      (await lookup.lookupMany(refs)).map((facts) =>
        facts !== null && ids.has(facts.id) ? { ...facts, status: 'published' } : facts,
      ),
    translations: (collection, group) => lookup.translations(collection, group),
  }
}

type PublishInput = Parameters<typeof publish>[0]
type PublishContext = Parameters<typeof publish>[1]

/**
 * Publishes an entry and the entries of its group in one step, all or none (ADR-024). Each entry
 * is checked as `publish` checks one, except that the contracts see every entry of the group as
 * published, so links between them resolve. The first entry that stops the group is named in
 * `failedEntry`. An acknowledgement, by contract and path, holds for every entry that reports
 * that warning, and each publication records its own warnings.
 */
async function publishGroup(input: PublishInput, context: PublishContext) {
  const actor = actorOf(context)
  const members = [{ id: input.id, version: input.version }, ...input.group].filter(
    (member, index, all) => all.findIndex((other) => other.id === member.id) === index,
  )
  const lookup = asPublished(
    context.store.lookup(context.site.key),
    new Set(members.map((member) => member.id)),
  )
  const checked: {
    summary: ReturnType<typeof entrySummary>
    collection: ReturnType<typeof collectionOfEntry>
    verdict: Verdict
    write: PublishWrite
  }[] = []
  for (const member of members) {
    const found = await context.store.findEntryById(context.site.key, member.id, 'head')
    if (found === null) return { outcome: 'not_found' as const, failedEntry: member.id }
    const { entry, revision } = found
    if (entry.version !== member.version) {
      return {
        outcome: 'conflict' as const,
        conflict: conflictAt(entry.version, entry.headRevision),
        failedEntry: member.id,
      }
    }
    const collection = collectionOfEntry(context.site, entry)
    const summary = entrySummary(found)
    const processed = await processFor(context.site, collection, revision.markdown)
    if (!processed.ok) {
      return {
        outcome: 'blocked' as const,
        entry: summary,
        verdict: refusalVerdict('publish', processed.violations),
        failedEntry: member.id,
      }
    }
    const verdict = await judge(
      context,
      collection,
      { locale: entry.locale, slug: entry.slug, entryId: entry.id },
      processed.value,
      'publish',
      lookup,
    )
    if (!verdict.ok) {
      return {
        outcome: 'blocked' as const,
        entry: summary,
        verdict: verdictView(verdict),
        failedEntry: member.id,
      }
    }
    checked.push({
      summary,
      collection,
      verdict,
      write: {
        entryId: entry.id,
        expectedVersion: member.version,
        verdict,
        acknowledged: verdict.warnings.map(({ contract, path }) => ({ contract, path })),
        actor,
        sortKey:
          sortKeyOf(collection, processed.value.frontmatter) ??
          entry.publishedAt ??
          context.clock.now().toISOString(),
      },
    })
  }
  const [main] = checked
  if (main === undefined) throw unexpectedAnswer(context, 'publish', { outcome: 'empty group' })
  // Every warning of the group once, by what an acknowledgement names.
  const warnings = new Map(
    checked
      .flatMap(({ verdict }) => verdict.warnings)
      .map((warning) => [warningKey(warning), warning]),
  )
  const acknowledged = new Set(input.acknowledgeWarnings.map(warningKey))
  if ([...warnings.keys()].some((key) => !acknowledged.has(key))) {
    return {
      outcome: 'needs_acknowledgement' as const,
      entry: main.summary,
      verdict: verdictView({ ...main.verdict, warnings: [...warnings.values()] }),
    }
  }
  const written = await context.store.publishGroup(
    context.site.key,
    checked.map(({ write }) => write),
  )
  switch (written.outcome) {
    case 'published': {
      const [view] = written.views
      if (view === undefined) throw unexpectedAnswer(context, 'publish', written)
      return {
        outcome: 'published' as const,
        entry: entrySummary(view),
        verdict: verdictView(main.verdict),
      }
    }
    case 'conflict':
      return {
        outcome: 'conflict' as const,
        conflict: conflictAt(written.currentVersion, written.headRevision),
        failedEntry: written.entryId,
      }
    case 'not_found':
      return { outcome: 'not_found' as const, failedEntry: written.entryId }
    case 'too_large': {
      const failed = checked.find(({ write }) => write.entryId === written.entryId) ?? main
      return {
        outcome: 'blocked' as const,
        entry: failed.summary,
        verdict: refusalVerdict('publish', [violationOf(written, failed.collection)]),
        failedEntry: written.entryId,
      }
    }
    case 'taken':
      throw unexpectedAnswer(context, 'publish', written)
  }
}
