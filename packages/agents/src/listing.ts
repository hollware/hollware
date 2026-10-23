import type { Hollware } from './hollware.ts'
import { list, text, type Json } from './read.ts'

export const MAX_PAGES = 3

export async function entriesOf(
  hollware: Hollware,
  query: { readonly collection: string; readonly locale?: string; readonly status?: string },
): Promise<Json[]> {
  const entries: Json[] = []
  let cursor: string | null = null
  for (let page = 0; page < MAX_PAGES; page++) {
    const answer = await hollware.call('list_entries', {
      ...query,
      limit: 100,
      ...(cursor === null ? {} : { cursor }),
    })
    entries.push(...list(answer['entries']))
    cursor = text(answer['nextCursor'])
    if (cursor === null) break
  }
  return entries
}
