/** What an entry is called in the admin: its title, or its slug when it has none. */
export function titleOf(entry: {
  readonly slug: string
  readonly frontmatter: Readonly<Record<string, unknown>>
}): string {
  const title = entry.frontmatter['title']
  return typeof title === 'string' && title.trim() !== '' ? title : entry.slug
}

/** The admin's path of an entry. */
export function entryPath(entry: {
  readonly collection: string
  readonly locale: string
  readonly slug: string
}): string {
  return `/entries/${entry.collection}/${entry.locale}/${entry.slug}`
}

export const STATUS_COLOR = { draft: 'neutral', scheduled: 'info', published: 'success' } as const

/** A date and time as the person reads them, in their locale and zone. */
export function when(iso: string): string {
  return new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })
}
