import { HollwareError } from '@hollware/core'
import type { Principal } from '../auth/types.ts'
import { actorOf } from './actor.ts'
import { entrySummary, reviewCommentView, reviewView } from './answers.ts'
import { unexpectedAnswer } from './errors.ts'
import { askForReview, publish } from './publish.ts'
import { agentsOfReviews, boundReview, outsideGrant } from './review-agents.ts'
import type { OperationContext, OperationHandler } from './types.ts'

export { approveReview } from './review-approve.ts'
export { getReview } from './review-read.ts'

export const listReviews: OperationHandler<'list_reviews'> = async (input, context) => {
  const site = context.site.key
  const bound = boundReview(context)
  const listed = await context.store.listReviews(site, {
    status: input.status,
    limit: input.limit,
    ...(input.entryId === undefined ? {} : { entryId: input.entryId }),
  })
  const found = bound === null ? listed : listed.filter((review) => review.id === bound)
  const ids = found.map((review) => review.id)
  const [comments, items, views, agents] = await Promise.all([
    context.store.reviewComments(site, ids),
    context.store.reviewItems(site, ids),
    context.store.findSummaries(
      site,
      found.map((review) => review.entryId),
      'head',
    ),
    agentsOfReviews(context, found),
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
          agents: [...(agents.get(review.id) ?? [])],
        },
      ]
    }),
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
  if (outsideGrant(context, input.id)) return { outcome: 'not_found' }
  const anchor = await anchorOf(input, context)
  const answer = await context.store.commentReview(context.site.key, {
    reviewId: input.id,
    actor: actorOf(context),
    body: input.body,
    ...anchor,
  })
  if (answer.outcome !== 'commented') return { outcome: answer.outcome }
  const { principal } = context
  if (principal.kind === 'token' && principal.agent !== undefined) {
    await context.store.markAgentRun(context.site.key, {
      reviewId: input.id,
      agent: principal.agent.name,
      status: 'commented',
    })
  }
  return { outcome: 'commented', comment: reviewCommentView(answer.comment) }
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
