import type { Hollware } from './hollware.ts'
import { list, text, type Json } from './read.ts'

/** The most pages of a listing a run reads: a call each, out of the fifty a free run has. */
export const MAX_PAGES = 3

/** The entries of a collection, in a locale and status when given, a page of 100 at a time. */
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
