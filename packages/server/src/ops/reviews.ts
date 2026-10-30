import { HollwareError, unifiedDiff } from '@hollware/core'
import type { Principal } from '../auth/types.ts'
import type { StoredReview, StoredReviewItem } from '../ports.ts'
import { actorOf } from './actor.ts'
import { conflictAt, entrySummary, reviewCommentView, reviewView } from './answers.ts'
import { checkChangeset } from './changeset.ts'
import { unexpectedAnswer } from './errors.ts'
import { askForReview, publish } from './publish.ts'
import type { OperationContext, OperationHandler } from './types.ts'

export const listReviews: OperationHandler<'list_reviews'> = async (input, context) => {
  const site = context.site.key
  const found = await context.store.listReviews(site, {
    status: input.status,
    limit: input.limit,
    ...(input.entryId === undefined ? {} : { entryId: input.entryId }),
  })
  const ids = found.map((review) => review.id)
  const [comments, items, views] = await Promise.all([
    context.store.reviewComments(site, ids),
    context.store.reviewItems(site, ids),
    context.store.findSummaries(
      site,
      found.map((review) => review.entryId),
      'head',
    ),
  ])
  const byEntry = new Map(views.map((view) => [view.entry.id, view]))
  return {
    outcome: 'ok',
    reviews: found.flatMap((review) => {
      const view = byEntry.get(review.entryId)
      if (view === undefined) return []
      return [
        {
          ...reviewView(review),
          entry: entrySummary(view),
          items: items.get(review.id)?.length ?? 0,
          comments: (comments.get(review.id) ?? []).map(reviewCommentView),
        },
      ]
    }),
  }
}

async function itemsOf(context: OperationContext, review: StoredReview) {
  const items = (await context.store.reviewItems(context.site.key, [review.id])).get(review.id)
  return items ?? []
}

export const getReview: OperationHandler<'get_review'> = async (input, context) => {
  const site = context.site.key
  const review = await context.store.findReview(site, input.id)
  if (review === null) return { outcome: 'not_found' }
  const [all, comments] = await Promise.all([
    itemsOf(context, review),
    context.store.reviewComments(site, [review.id]),
  ])
  const items = all.filter((item) => input.entryId === undefined || item.entryId === input.entryId)
  const [views, markdown] = await Promise.all([
    context.store.findSummaries(
      site,
      items.map((item) => item.entryId),
      'head',
    ),
    context.store.revisionMarkdown(
      site,
      items.flatMap((item) => [item.revisionId, item.baseRevisionId].filter((id) => id !== null)),
    ),
  ])
  const byEntry = new Map(views.map((view) => [view.entry.id, view]))
  const textOf = (id: string | null) => (id === null ? null : (markdown.get(id) ?? null))
  return {
    outcome: 'ok',
    review: {
      ...reviewView(review),
      comments: (comments.get(review.id) ?? []).map(reviewCommentView),
    },
    items: items.flatMap((item) => {
      const view = byEntry.get(item.entryId)
      if (view === undefined) return []
      const published = textOf(item.baseRevisionId)
      const proposed = textOf(item.revisionId)
      return [
        {
          entry: entrySummary(view),
          action: item.action,
          excluded: item.excluded,
          published,
          proposed,
          diff: unifiedDiff(published ?? '', proposed ?? ''),
        },
      ]
    }),
  }
}

function isChangeset(items: readonly StoredReviewItem[]): boolean {
  return items.length > 1 || items.some((item) => item.action === 'unpublish')
}

export const approveReview: OperationHandler<'approve_review'> = async (input, context) => {
  const site = context.site.key
  const review = await context.store.findReview(site, input.id)
  if (review === null) return { outcome: 'not_found' }
  if (review.status !== 'pending') return { outcome: 'not_pending', review: reviewView(review) }
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

export const requestChanges: OperationHandler<'request_changes'> = async (input, context) => {
  const { userId } = actorOf(context)
  const closed = await context.store.requestChanges(context.site.key, {
    id: input.id,
    note: input.note,
    userId,
  })
  if (closed.outcome === 'not_found') return { outcome: 'not_found' }
  return { outcome: closed.outcome, review: reviewView(closed.review) }
}

export const rejectReview: OperationHandler<'reject_review'> = async (input, context) => {
  const { userId } = actorOf(context)
  const closed = await context.store.rejectReview(context.site.key, {
    id: input.id,
    note: input.reason,
    userId,
  })
  if (closed.outcome === 'not_found') return { outcome: 'not_found' }
  return { outcome: closed.outcome, review: reviewView(closed.review) }
}

async function anchorOf(
  input: Parameters<typeof commentReview>[0],
  context: OperationContext,
): Promise<{
  readonly entryId: string | null
  readonly lines: { from: number; to: number } | null
}> {
  if (input.entryId === undefined) {
    if (input.lines !== undefined) {
      throw new HollwareError(
        'invalid_input',
        'Lines of a comment belong to an entry of the review, and no entryId was given.',
        'Pass entryId with lines, or leave lines out to comment on the whole review.',
      )
    }
    return { entryId: null, lines: null }
  }
  const items = (await context.store.reviewItems(context.site.key, [input.id])).get(input.id) ?? []
  if (items.length === 0) return { entryId: input.entryId, lines: input.lines ?? null }
  const item = items.find((candidate) => candidate.entryId === input.entryId)
  if (item === undefined) {
    throw new HollwareError(
      'invalid_input',
      `The entry ${input.entryId} is not in the review ${input.id}.`,
      'Comment on an entry that get_review lists for this review.',
    )
  }
  if (input.lines === undefined) return { entryId: item.entryId, lines: null }
  const text =
    item.revisionId === null
      ? ''
      : ((await context.store.revisionMarkdown(context.site.key, [item.revisionId])).get(
          item.revisionId,
        ) ?? '')
  const count = text === '' ? 0 : text.split('\n').length - (text.endsWith('\n') ? 1 : 0)
  if (input.lines.from > input.lines.to || input.lines.to > count) {
    throw new HollwareError(
      'invalid_input',
      `The lines ${input.lines.from} to ${input.lines.to} are not lines of the proposed Markdown of ${item.entryId}, which has ${count}.`,
      `Name lines from 1 to ${count}, the first not after the last.`,
    )
  }
  return { entryId: item.entryId, lines: { from: input.lines.from, to: input.lines.to } }
}

export const commentReview: OperationHandler<'comment_review'> = async (input, context) => {
  const anchor = await anchorOf(input, context)
  const answer = await context.store.commentReview(context.site.key, {
    reviewId: input.id,
    actor: actorOf(context),
    body: input.body,
    ...anchor,
  })
  return answer.outcome === 'commented'
    ? { outcome: 'commented', comment: reviewCommentView(answer.comment) }
    : { outcome: answer.outcome }
}

export const requestReview: OperationHandler<'request_review'> = async (input, context) => {
  if (input.group.length > 0 || input.unpublish.length > 0) {
    return askForReview(input, context)
  }
  const { principal: given } = context
  const principal: Principal =
    given.kind === 'binding'
      ? given
      : { ...given, scopes: given.scopes.filter((scope) => scope !== 'content:publish') }
  const answer = await publish(
    {
      id: input.id,
      version: input.version,
      acknowledgeWarnings: input.acknowledgeWarnings,
      group: [],
    },
    { ...context, principal },
  )
  switch (answer.outcome) {
    case 'pending_review':
    case 'blocked':
    case 'needs_acknowledgement':
    case 'conflict':
    case 'not_found':
      return {
        outcome: answer.outcome,
        ...(answer.entry === undefined ? {} : { entry: answer.entry }),
        ...(answer.verdict === undefined ? {} : { verdict: answer.verdict }),
        ...(answer.conflict === undefined ? {} : { conflict: answer.conflict }),
        ...(answer.review === undefined ? {} : { review: answer.review }),
      }
    default:
      throw unexpectedAnswer(context, 'request_review', answer)
  }
}
