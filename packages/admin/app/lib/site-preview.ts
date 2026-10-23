import type { Api } from './api.ts'

export interface PreviewLink {
  readonly token: string
  readonly expiresAt: string
  readonly url: string | null
}

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
