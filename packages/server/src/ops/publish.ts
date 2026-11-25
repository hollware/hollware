import { HollwareError, type Scope } from '@hollware/core'
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
import {
  checkChangeset,
  distinctMembers,
  refuseOverlap,
  warningKey,
  type Checked,
} from './changeset.ts'
import { collectionOfEntry } from './collections.ts'
import { judge, processFor, sortKeyOf } from './draft.ts'
import { unexpectedAnswer } from './errors.ts'
import { TREE_ATTEMPTS, treeOf } from './tree.ts'
import type { OperationContext, OperationHandler } from './types.ts'

export const publish: OperationHandler<'publish'> = (input, context) =>
  publishAttempt(input, context, TREE_ATTEMPTS)

async function stillChanging(context: OperationContext, id: string, failedEntry?: string) {
  const found = await context.store.findEntryById(context.site.key, id, 'head')
  if (found === null) return { outcome: 'not_found' as const }
  return {
    outcome: 'conflict' as const,
    conflict: conflictAt(found.entry.version, found.entry.headRevision),
    ...(failedEntry === undefined ? {} : { failedEntry }),
  }
}

async function publishAttempt(
  input: Parameters<OperationHandler<'publish'>>[0],
  context: OperationContext,
  attempts: number,
): ReturnType<OperationHandler<'publish'>> {
  const granted: readonly Scope[] = context.principal.scopes
  const mayPublish = granted.includes('content:publish')
  if (!mayPublish && input.publishAt !== undefined) {
    throw new HollwareError(
      'invalid_input',
      'Without content:publish, publish asks for a review now, not at a time.',
      'Publish without publishAt; a person who may publish approves it.',
    )
  }
  if (!mayPublish && input.group.length > 0)
    return askForReview({ ...input, unpublish: [] }, context)
  if (input.group.length > 0) return publishGroup(input, context, attempts)
  const actor = actorOf(context)
  const found = await context.store.findEntryById(context.site.key, input.id, 'head')
  if (found === null) return { outcome: 'not_found' }
  const { entry, revision } = found
  const collection = collectionOfEntry(context.site, entry)
  if (entry.version !== input.version) {
    return { outcome: 'conflict', conflict: conflictAt(entry.version, entry.headRevision) }
  }
  const summary = entrySummary(found)
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
    { locale: entry.locale, slug: entry.slug, entryId: entry.id, slugPath: entry.slugPath },
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
      items: [{ entryId: entry.id, expectedVersion: input.version, action: 'publish' }],
      acknowledged: acknowledgedWarnings,
      actor,
    })
    switch (asked.outcome) {
      case 'pending_review':
      case 'held':
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
  if (isLater(context, input.publishAt)) {
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
    slugPath: entry.slugPath,
    at: context.clock.now().toISOString(),
  })
  const written = await context.store.publish(context.site.key, {
    event,
    entryId: entry.id,
    expectedVersion: input.version,
    verdict,
    acknowledged: verdict.warnings.map(({ contract, path }) => ({ contract, path })),
    actor,
    sortKey:
      sortKeyOf(collection, processed.value.frontmatter) ??
      entry.publishedAt ??
      context.clock.now().toISOString(),
    tree: treeOf(context.site, entry.collection, entry.locale),
  })
  switch (written.outcome) {
    case 'tree_changed':
      return attempts > 1
        ? publishAttempt(input, context, attempts - 1)
        : stillChanging(context, entry.id)
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
      return {
        outcome: 'blocked',
        entry: summary,
        verdict: refusalVerdict('publish', [violationOf(written, collection)]),
      }
    case 'taken':
      throw unexpectedAnswer(context, 'publish', written)
  }
}

type PublishInput = Parameters<typeof publish>[0]
type PublishContext = Parameters<typeof publish>[1]

function isLater(context: PublishContext, publishAt: string | undefined): publishAt is string {
  return publishAt !== undefined && Date.parse(publishAt) > context.clock.now().getTime()
}

async function scheduleGroup(
  input: PublishInput & { readonly publishAt: string },
  context: PublishContext,
  checked: readonly Checked[],
) {
  const [main] = checked
  if (main === undefined) throw unexpectedAnswer(context, 'publish', { outcome: 'empty group' })
  const live = checked.find(({ summary }) => summary.status === 'published')
  if (live !== undefined) {
    throw new HollwareError(
      'invalid_input',
      `The entry ${live.summary.id} of the group is published, so its publication cannot be scheduled.`,
      'Leave the published entries out of a scheduled group and publish their changes now, or unpublish them first.',
    )
  }
  const scheduled = await context.store.scheduleGroup(context.site.key, {
    members: checked.map(({ write }) => ({
      entryId: write.entryId,
      expectedVersion: write.expectedVersion,
    })),
    scheduledAt: new Date(input.publishAt).toISOString(),
    acknowledged: checked.flatMap(({ write }) => write.acknowledged),
    actor: actorOf(context),
  })
  switch (scheduled.outcome) {
    case 'scheduled': {
      const [view] = scheduled.views
      if (view === undefined) throw unexpectedAnswer(context, 'publish', scheduled)
      return {
        outcome: 'scheduled' as const,
        entry: entrySummary(view),
        verdict: verdictView(main.verdict),
      }
    }
    case 'conflict':
      return {
        outcome: 'conflict' as const,
        conflict: conflictAt(scheduled.currentVersion, scheduled.headRevision),
        failedEntry: scheduled.entryId,
      }
    case 'not_found':
      return { outcome: 'not_found' as const, failedEntry: scheduled.entryId }
    default:
      throw unexpectedAnswer(context, 'publish', scheduled)
  }
}

async function publishGroup(input: PublishInput, context: PublishContext, attempts: number) {
  const found = await checkChangeset(context, {
    publish: distinctMembers([{ id: input.id, version: input.version }, ...input.group]),
    unpublish: [],
    acknowledgeWarnings: input.acknowledgeWarnings,
  })
  if (found.outcome !== 'checked') return found
  const { checked } = found
  const { publishAt } = input
  if (isLater(context, publishAt)) return scheduleGroup({ ...input, publishAt }, context, checked)
  const [main] = checked
  if (main === undefined) throw unexpectedAnswer(context, 'publish', { outcome: 'empty group' })
  const written = await context.store.publishGroup(
    context.site.key,
    checked.map(({ write }) => write),
  )
  switch (written.outcome) {
    case 'tree_changed':
      return attempts > 1
        ? publishAttempt(input, context, attempts - 1)
        : stillChanging(context, input.id, input.id)
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

export async function askForReview(
  input: {
    readonly id: string
    readonly version: number
    readonly group: readonly { readonly id: string; readonly version: number }[]
    readonly unpublish: readonly { readonly id: string; readonly version: number }[]
    readonly acknowledgeWarnings: readonly { readonly contract: string; readonly path: string }[]
  },
  context: PublishContext,
) {
  const members = distinctMembers([{ id: input.id, version: input.version }, ...input.group])
  const unpublish = distinctMembers(input.unpublish)
  refuseOverlap(members, unpublish)
  const found = await checkChangeset(context, {
    publish: members,
    unpublish,
    acknowledgeWarnings: input.acknowledgeWarnings,
  })
  if (found.outcome !== 'checked') return found
  const [main] = found.checked
  if (main === undefined) throw unexpectedAnswer(context, 'request_review', found)
  const asked = await context.store.requestReview(context.site.key, {
    items: [
      ...members.map((member) => ({
        entryId: member.id,
        expectedVersion: member.version,
        action: 'publish' as const,
      })),
      ...unpublish.map((member) => ({
        entryId: member.id,
        expectedVersion: member.version,
        action: 'unpublish' as const,
      })),
    ],
    acknowledged: found.checked.flatMap(({ verdict }) =>
      verdict.warnings.map(({ contract, path }) => ({ contract, path })),
    ),
    actor: actorOf(context),
  })
  switch (asked.outcome) {
    case 'pending_review':
      return {
        outcome: 'pending_review' as const,
        entry: main.summary,
        verdict: verdictView(main.verdict),
        review: reviewView(asked.review),
      }
    case 'held':
      return {
        outcome: 'conflict' as const,
        review: reviewView(asked.review),
        failedEntry: asked.entryId,
      }
    case 'conflict':
      return {
        outcome: 'conflict' as const,
        conflict: conflictAt(asked.currentVersion, asked.headRevision),
        failedEntry: asked.entryId,
      }
    case 'not_found':
      return { outcome: 'not_found' as const, failedEntry: asked.entryId }
    default:
      throw unexpectedAnswer(context, 'request_review', asked)
  }
}
