export type ListStatus = 'draft' | 'scheduled' | 'published'

export interface Listed {
  readonly id: string
  readonly status: ListStatus
  readonly deletedAt: string | null
  readonly updatedAt: string
}

export interface ListRow extends Listed {
  readonly title: string
  readonly slug: string
  readonly collection: string
  readonly locale: string
  readonly scheduledAt: string | null
  readonly hasUnpublishedChanges: boolean
  readonly translationOutdated?: boolean
}

export interface Group<T> {
  readonly key: ListStatus | 'trash'
  readonly rows: readonly T[]
}

const ORDER: readonly (ListStatus | 'trash')[] = ['draft', 'scheduled', 'published', 'trash']

export function groupRows<T extends Listed>(rows: readonly T[]): Group<T>[] {
  const groups = new Map<ListStatus | 'trash', T[]>()
  for (const row of rows) {
    const key = row.deletedAt === null ? row.status : 'trash'
    groups.set(key, [...(groups.get(key) ?? []), row])
  }
  return ORDER.flatMap((key) => {
    const found = groups.get(key)
    if (found === undefined) return []
    return [{ key, rows: [...found].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)) }]
  })
}

export function visibleRows<T extends Listed>(
  groups: readonly Group<T>[],
  folded: ReadonlySet<string>,
): T[] {
  return groups.flatMap((group) => (folded.has(group.key) ? [] : [...group.rows]))
}

export function nextIndex(current: number, length: number, step: 1 | -1): number {
  if (length === 0) return -1
  if (current < 0) return step === 1 ? 0 : length - 1
  return Math.min(length - 1, Math.max(0, current + step))
}

export function toggled(selected: readonly string[], id: string): string[] {
  return selected.includes(id) ? selected.filter((other) => other !== id) : [...selected, id]
}

export function matches(
  row: { readonly slug: string; readonly title: string; readonly tags?: readonly string[] },
  query: string,
): boolean {
  const term = query.trim().toLowerCase()
  if (term === '') return true
  return (
    row.title.toLowerCase().includes(term) ||
    row.slug.toLowerCase().includes(term) ||
    (row.tags ?? []).some((tag) => tag.toLowerCase().includes(term))
  )
}
