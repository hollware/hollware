import { unifiedDiff } from '@hollware/core'
import { entrySummary, reviewCommentView, reviewView } from './answers.ts'
import { agentsOfReviews, outsideGrant } from './review-agents.ts'
import type { OperationHandler } from './types.ts'

export const getReview: OperationHandler<'get_review'> = async (input, context) => {
  const site = context.site.key
  if (outsideGrant(context, input.id)) return { outcome: 'not_found' }
  const review = await context.store.findReview(site, input.id)
  if (review === null) return { outcome: 'not_found' }
  const [all, comments, agents] = await Promise.all([
    context.store.reviewItems(site, [review.id]),
    context.store.reviewComments(site, [review.id]),
    agentsOfReviews(context, [review]),
  ])
  const items = (all.get(review.id) ?? []).filter(
    (item) => input.entryId === undefined || item.entryId === input.entryId,
  )
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
      agents: [...(agents.get(review.id) ?? [])],
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
