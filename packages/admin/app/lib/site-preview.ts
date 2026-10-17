import type { Api } from './api.ts'

/** What the admin's route of previews answers (T-103). */
export interface PreviewLink {
  readonly token: string
  readonly expiresAt: string
  /** The entry's page on the site with the token in its query, or `null` when it has no URL. */
  readonly url: string | null
}

/**
 * Asks the server for a link that shows the latest revision of an entry on the site, and opens it
 * through `open`. `no_url` is the site having no page for the entry: nothing is opened.
 */
export async function openPreview(
  api: Pick<Api, 'admin'>,
  entryId: string,
  open: (url: string) => void,
): Promise<'opened' | 'no_url'> {
  const link = await api.admin<PreviewLink>('preview', { entryId })
  if (link.url === null) return 'no_url'
  open(link.url)
  return 'opened'
}
