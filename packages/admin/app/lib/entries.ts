export function titleOf(entry: {
  readonly slug: string
  readonly frontmatter: Readonly<Record<string, unknown>>
}): string {
  const title = entry.frontmatter['title']
  return typeof title === 'string' && title.trim() !== '' ? title : entry.slug
}

export function entryPath(entry: {
  readonly collection: string
  readonly locale: string
  readonly slug: string
}): string {
  return `/entries/${entry.collection}/${entry.locale}/${entry.slug}`
}

export const STATUS_COLOR = { draft: 'neutral', scheduled: 'info', published: 'success' } as const
