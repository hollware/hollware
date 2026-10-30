export function indexAfterReload(
  chosen: string | null,
  previous: number,
  ids: readonly string[],
): number {
  const kept = chosen === null ? -1 : ids.indexOf(chosen)
  return kept >= 0 ? kept : Math.min(previous, ids.length - 1)
}

export interface CommentAnchor {
  readonly entryId: string
  readonly lines?: { readonly from: number; readonly to: number }
}

export function anchorOf(entryId: string, from: number | null, to: number | null): CommentAnchor {
  if (from === null) return { entryId }
  return { entryId, lines: { from, to: to === null || to < from ? from : to } }
}

export function commentsOn<Comment extends { readonly entryId: string | null }>(
  comments: readonly Comment[],
  entryId: string | null,
): Comment[] {
  return comments.filter((comment) => comment.entryId === entryId)
}

export function exclusionOf(excluded: ReadonlySet<string>, entryIds: readonly string[]): string[] {
  return entryIds.filter((id) => excluded.has(id))
}
