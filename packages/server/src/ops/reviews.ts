import { actorOf } from './actor.ts'
import { entrySummary, reviewCommentView, reviewView } from './answers.ts'
import { unexpectedAnswer } from './errors.ts'
import { publish } from './publish.ts'
import type { OperationHandler } from './types.ts'

/**
 * The reviews of v0.3: what a person who may publish does with the requests of those who may
 * only write. `publish` makes a request (`pending_review`); these list them, approve one, which
 * publishes it through `publish` itself, or close one with a note.
 */

/** The requests of one status, newest first, each with its entry as it is now. */
export const listReviews: OperationHandler<'list_reviews'> = async (input, context) => {
  const found = await context.store.listReviews(context.site.key, {
    status: input.status,
    limit: input.limit,
  })
  const comments = await context.store.reviewComments(
    context.site.key,
    found.map((review) => review.id),
  )
  const reviews = []
  for (const review of found) {
    const view = await context.store.findEntryById(context.site.key, review.entryId, 'head')
    // An entry is never deleted while a review names it (the foreign key), so this is a bug.
    if (view === null) throw unexpectedAnswer(context, 'list_reviews', { outcome: 'no entry' })
    reviews.push({
      ...reviewView(review),
      entry: entrySummary(view),
      comments: (comments.get(review.id) ?? []).map(reviewCommentView),
    })
  }
  return { outcome: 'ok', reviews }
}

/**
 * Publishes what a pending review asked for, through `publish`, in the approver's name: the
 * contracts run again, and the warnings the request acknowledged count as acknowledged. The
 * publication approves the review in its own batch. A review that is no longer pending answers
 * `not_pending`.
 */
export const approveReview: OperationHandler<'approve_review'> = async (input, context) => {
  const site = context.site.key
  const review = await context.store.findReview(site, input.id)
  if (review === null) return { outcome: 'not_found' }
  if (review.status !== 'pending') return { outcome: 'not_pending', review: reviewView(review) }
  // A pending review is of the head: a new revision cancels it in the batch that saves it.
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
      // The entry moved between the read and the write: a new revision cancelled the review, or
      // someone published it.
      const now = (await context.store.findReview(site, review.id)) ?? review
      return { outcome: 'not_pending', review: reviewView(now) }
    }
    case 'not_found':
      return { outcome: 'not_found' }
    default:
      throw unexpectedAnswer(context, 'approve_review', answer)
  }
}

/** Closes a pending review with a note, without publishing. */
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

/**
 * A comment on a pending review, in the name of the caller: for the person who decides and for
 * the author. It decides nothing; a review that is no longer pending takes none.
 */
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
