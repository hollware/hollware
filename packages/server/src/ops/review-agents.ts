import type { StoredReview } from '../ports.ts'
import type { OperationContext } from './types.ts'

export interface ReviewAgentView {
  readonly name: string
  readonly status: 'queued' | 'commented' | 'failed'
  readonly required: boolean
}

export function reviewingAgents(context: OperationContext) {
  return context.site.agents.filter((agent) => agent.events.includes('review.requested'))
}

export function requiredAgents(context: OperationContext) {
  if (!context.site.review.requireAgents) return []
  return reviewingAgents(context).filter((agent) => agent.required)
}

export async function agentsOfReviews(
  context: OperationContext,
  reviews: readonly StoredReview[],
): Promise<ReadonlyMap<string, readonly ReviewAgentView[]>> {
  const declared = reviewingAgents(context)
  const views = new Map<string, ReviewAgentView[]>()
  if (declared.length === 0 || reviews.length === 0) return views
  const runs = await context.store.reviewAgentRuns(
    context.site.key,
    reviews.map((review) => review.id),
  )
  for (const review of reviews) {
    const done = runs.get(review.id) ?? []
    views.set(
      review.id,
      declared.map((agent) => ({
        name: agent.name,
        status: done.find((run) => run.agent === agent.name)?.status ?? 'queued',
        required: agent.required,
      })),
    )
  }
  return views
}

export function boundReview(context: OperationContext): string | null {
  const { principal } = context
  return principal.kind === 'token' ? (principal.agent?.review ?? null) : null
}

export function outsideGrant(context: OperationContext, reviewId: string): boolean {
  const bound = boundReview(context)
  return bound !== null && bound !== reviewId
}
