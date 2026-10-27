export interface PendingReview {
  readonly id: string
  readonly requestedByName: string | null
  readonly requestedAt: string
}

export function holdsSave(pending: PendingReview | null, confirmed: boolean): boolean {
  return pending !== null && !confirmed
}

export function reviewLink(pending: PendingReview): {
  readonly path: string
  readonly query: { readonly review: string }
} {
  return { path: '/reviews', query: { review: pending.id } }
}
