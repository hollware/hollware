import type { Principal } from '../auth/types.ts'
import { actorOf } from './actor.ts'
import { entrySummary, reviewCommentView, reviewView } from './answers.ts'
import { unexpectedAnswer } from './errors.ts'
import { publish } from './publish.ts'
import type { OperationHandler } from './types.ts'

export const listReviews: OperationHandler<'list_reviews'> = async (input, context) => {
  const found = await context.store.listReviews(context.site.key, {
    status: input.status,
    limit: input.limit,
    ...(input.entryId === undefined ? {} : { entryId: input.entryId }),
  })
  const comments = await context.store.reviewComments(
    context.site.key,
    found.map((review) => review.id),
  )
  const reviews = []
  for (const review of found) {
    const view = await context.store.findEntryById(context.site.key, review.entryId, 'head')
    if (view === null) continue
    reviews.push({
      ...reviewView(review),
      entry: entrySummary(view),
      comments: (comments.get(review.id) ?? []).map(reviewCommentView),
    })
  }
  return { outcome: 'ok', reviews }
}

export const approveReview: OperationHandler<'approve_review'> = async (input, context) => {
  const site = context.site.key
  const review = await context.store.findReview(site, input.id)
  if (review === null) return { outcome: 'not_found' }
  if (review.status !== 'pending') return { outcome: 'not_pending', review: reviewView(review) }
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

export const commentReview: OperationHandler<'comment_review'> = async (input, context) => {
  const answer = await context.store.commentReview(context.site.key, {
    reviewId: input.id,
    actor: actorOf(context),
    body: input.body,
  })
  return answer.outcome === 'commented'
    ? { outcome: 'commented', comment: reviewCommentView(answer.comment) }
    : { outcome: answer.outcome }
}

export const requestReview: OperationHandler<'request_review'> = async (input, context) => {
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
