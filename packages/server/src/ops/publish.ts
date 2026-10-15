import { HollwareError, type EntryLookup, type Scope, type Verdict } from '@hollware/core'
import type { PublishWrite } from '../ports.ts'
import { eventFor } from './event.ts'
import { actorOf } from './actor.ts'
import {
  conflictAt,
  entrySummary,
  refusalVerdict,
  reviewView,
  verdictView,
  violationOf,
} from './answers.ts'
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
 *
 * A caller without `content:publish` goes through the same checks, and then asks for a review
 * instead of publishing (v0.3): the answer is `pending_review`, and a person who may publish
 * decides. A review is for one entry, now.
 */
export const publish: OperationHandler<'publish'> = async (input, context) => {
  const granted: readonly Scope[] = context.principal.scopes
  const mayPublish = granted.includes('content:publish')
  if (!mayPublish && (input.group.length > 0 || input.publishAt !== undefined)) {
    throw new HollwareError(
      'invalid_input',
      'Without content:publish, publish asks for a review of one entry, now: not of a group, and not at a time.',
      'Publish each entry on its own, without group and publishAt; a person who may publish approves it.',
    )
  }
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
  const acknowledgedWarnings = verdict.warnings.map(({ contract, path }) => ({ contract, path }))
  if (!mayPublish) {
    const asked = await context.store.requestReview(context.site.key, {
      entryId: entry.id,
      expectedVersion: input.version,
      acknowledged: acknowledgedWarnings,
      actor,
    })
    switch (asked.outcome) {
      case 'pending_review':
        return {
          outcome: 'pending_review',
          entry: summary,
          verdict: verdictView(verdict),
          review: reviewView(asked.review),
        }
      case 'conflict':
        return {
          outcome: 'conflict',
          conflict: conflictAt(asked.currentVersion, asked.headRevision),
        }
      case 'not_found':
        return { outcome: 'not_found' }
      default:
        throw unexpectedAnswer(context, 'publish', asked)
    }
  }
  if (
    input.publishAt !== undefined &&
    Date.parse(input.publishAt) > context.clock.now().getTime()
  ) {
    if (entry.status === 'published') {
      throw new HollwareError(
        'invalid_input',
        'The entry is published, so its publication cannot be scheduled.',
        'Publish its changes now, without publishAt, or unpublish it first and then schedule it.',
      )
    }
    const scheduled = await context.store.schedule(context.site.key, {
      entryId: entry.id,
      expectedVersion: input.version,
      scheduledAt: new Date(input.publishAt).toISOString(),
      acknowledged: acknowledgedWarnings,
      actor,
    })
    switch (scheduled.outcome) {
      case 'scheduled':
        return {
          outcome: 'scheduled',
          entry: entrySummary(scheduled.view),
          verdict: verdictView(verdict),
        }
      case 'conflict':
        return {
          outcome: 'conflict',
          conflict: conflictAt(scheduled.currentVersion, scheduled.headRevision),
        }
      case 'not_found':
        return { outcome: 'not_found' }
      default:
        throw unexpectedAnswer(context, 'publish', scheduled)
    }
  }
  const event = eventFor({
    kind: 'entry.published',
    site: context.site,
    collection,
    entry: {
      id: entry.id,
      collection: entry.collection,
      locale: entry.locale,
      slug: entry.slug,
      translationGroup: entry.translationGroup,
    },
    at: context.clock.now().toISOString(),
  })
  const written = await context.store.publish(context.site.key, {
    event,
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
      context.notify?.([event.id])
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
  if (input.publishAt !== undefined) {
    throw new HollwareError(
      'invalid_input',
      'A group cannot be scheduled: publishAt schedules one entry.',
      'Publish the group now, without publishAt, or schedule its entries one by one.',
    )
  }
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
        event: eventFor({
          kind: 'entry.published',
          site: context.site,
          collection,
          entry: {
            id: entry.id,
            collection: entry.collection,
            locale: entry.locale,
            slug: entry.slug,
            translationGroup: entry.translationGroup,
          },
          at: context.clock.now().toISOString(),
        }),
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
  // An acknowledgement holds for every member; the first member with a warning that nobody
  // acknowledged is named, with its own verdict, so that a client can deal with it and go on.
  const acknowledged = new Set(input.acknowledgeWarnings.map(warningKey))
  const pending = checked.find(({ verdict }) =>
    verdict.warnings.some((warning) => !acknowledged.has(warningKey(warning))),
  )
  if (pending !== undefined) {
    return {
      outcome: 'needs_acknowledgement' as const,
      entry: pending.summary,
      verdict: verdictView(pending.verdict),
      failedEntry: pending.write.entryId,
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
      context.notify?.(checked.flatMap(({ write }) => (write.event ? [write.event.id] : [])))
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
