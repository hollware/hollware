import { HollwareError, type Scope } from '@hollware/core'
import type { StoredReview, StoredReviewItem } from '../ports.ts'
import { actorOf } from './actor.ts'
import { conflictAt, entrySummary, reviewView } from './answers.ts'
import { checkChangeset } from './changeset.ts'
import { unexpectedAnswer } from './errors.ts'
import { publish } from './publish.ts'
import { requiredAgents } from './review-agents.ts'
import type { OperationContext, OperationHandler } from './types.ts'

async function itemsOf(context: OperationContext, review: StoredReview) {
  const items = (await context.store.reviewItems(context.site.key, [review.id])).get(review.id)
  return items ?? []
}

async function pendingAgents(context: OperationContext, review: StoredReview, override: boolean) {
  const required = requiredAgents(context)
  if (required.length === 0) return []
  const scopes: readonly Scope[] = context.principal.scopes
  if (override && scopes.includes('schema:admin')) return []
  const runs = (await context.store.reviewAgentRuns(context.site.key, [review.id])).get(review.id)
  return required.flatMap((agent) => {
    const status = runs?.find((run) => run.agent === agent.name)?.status ?? 'queued'
    return status === 'commented' ? [] : [{ name: agent.name, status, required: true }]
  })
}

function isChangeset(items: readonly StoredReviewItem[]): boolean {
  return items.length > 1 || items.some((item) => item.action === 'unpublish')
}

export const approveReview: OperationHandler<'approve_review'> = async (input, context) => {
  const site = context.site.key
  const review = await context.store.findReview(site, input.id)
  if (review === null) return { outcome: 'not_found' }
  if (review.status !== 'pending') return { outcome: 'not_pending', review: reviewView(review) }
  const waiting = await pendingAgents(context, review, input.override)
  if (waiting.length > 0) {
    return { outcome: 'agents_pending', review: reviewView(review), agents: waiting }
  }
  const items = await itemsOf(context, review)
  const outside = input.exclude.find((id) => !items.some((item) => item.entryId === id))
  if (outside !== undefined) {
    throw new HollwareError(
      'invalid_input',
      `The entry ${outside} is not in the review ${review.id}.`,
      'Exclude only entries that get_review lists for this review.',
    )
  }
  if (isChangeset(items) || input.exclude.length > 0) {
    return approveChangeset(input, context, review, items)
  }
  const found = await context.store.findEntryById(site, review.entryId, 'head')
  if (found === null) return { outcome: 'not_found' }
  const answer = await publish(
    {
      id: found.entry.id,
      version: found.entry.version,
      acknowledgeWarnings: [...review.acknowledged, ...input.acknowledgeWarnings],
      group: [],
    },
    context,
  )
  switch (answer.outcome) {
    case 'published': {
      const decided = (await context.store.findReview(site, review.id)) ?? review
      return {
        outcome: 'published',
        review: reviewView(decided),
        ...(answer.entry === undefined ? {} : { entry: answer.entry }),
        ...(answer.verdict === undefined ? {} : { verdict: answer.verdict }),
      }
    }
    case 'blocked':
    case 'needs_acknowledgement':
      return {
        outcome: answer.outcome,
        review: reviewView(review),
        ...(answer.entry === undefined ? {} : { entry: answer.entry }),
        ...(answer.verdict === undefined ? {} : { verdict: answer.verdict }),
      }
    case 'conflict': {
      const now = (await context.store.findReview(site, review.id)) ?? review
      return { outcome: 'not_pending', review: reviewView(now) }
    }
    case 'not_found':
      return { outcome: 'not_found' }
    default:
      throw unexpectedAnswer(context, 'approve_review', answer)
  }
}

async function approveChangeset(
  input: Parameters<typeof approveReview>[0],
  context: OperationContext,
  review: StoredReview,
  items: readonly StoredReviewItem[],
) {
  const excluded = new Set(input.exclude)
  const included = items.filter((item) => !excluded.has(item.entryId))
  if (included.length === 0) {
    throw new HollwareError(
      'invalid_input',
      'Every entry of the review is excluded, so approving it would change nothing.',
      'Leave at least one entry out of exclude, or close the review with reject_review.',
    )
  }
  const member = (item: StoredReviewItem) => ({
    id: item.entryId,
    revision: item.action === 'publish' ? item.revisionId : item.baseRevisionId,
  })
  const found = await checkChangeset(context, {
    publish: included.filter((item) => item.action === 'publish').map(member),
    unpublish: included.filter((item) => item.action === 'unpublish').map(member),
    acknowledgeWarnings: [...review.acknowledged, ...input.acknowledgeWarnings],
  })
  if (found.outcome !== 'checked') return { ...found, review: reviewView(review) }
  const written = await context.store.approveReview(context.site.key, {
    reviewId: review.id,
    userId: actorOf(context).userId,
    publishes: found.checked.map(({ write }) => write),
    unpublishes: found.unpublishes,
    excluded: [...excluded],
  })
  switch (written.outcome) {
    case 'approved': {
      context.notify?.([
        ...found.checked.flatMap(({ write }) => (write.event ? [write.event.id] : [])),
        ...found.unpublishes.flatMap((write) => (write.event ? [write.event.id] : [])),
      ])
      const [main] = found.checked
      const view =
        main === undefined
          ? null
          : await context.store.findEntryById(context.site.key, main.write.entryId, 'head')
      return {
        outcome: 'published' as const,
        review: reviewView(written.review),
        ...(view === null ? {} : { entry: entrySummary(view) }),
      }
    }
    case 'not_pending':
      return { outcome: 'not_pending' as const, review: reviewView(written.review) }
    case 'not_found':
      return { outcome: 'not_found' as const }
    case 'conflict':
      return {
        outcome: 'conflict' as const,
        review: reviewView(review),
        conflict: conflictAt(written.currentVersion, written.headRevision),
        failedEntry: written.entryId,
      }
    case 'too_large':
    case 'taken':
      throw unexpectedAnswer(context, 'approve_review', written)
  }
}
