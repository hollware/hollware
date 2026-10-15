import { entrySummary } from './answers.ts'
import { requireCollection, requireLocale } from './collections.ts'
import type { OperationHandler } from './types.ts'

/** The published entries of the site that hold every word of the query, best first. */
export const search: OperationHandler<'search'> = async (input, context) => {
  if (input.collection !== undefined) requireCollection(context.site, input.collection)
  if (input.locale !== undefined) requireLocale(context.site, input.locale)
  const hits = await context.store.searchEntries(context.site.key, {
    text: input.query,
    collection: input.collection,
    locale: input.locale,
    limit: input.limit,
  })
  return {
    outcome: 'ok',
    results: hits.map((hit) => ({
      entry: entrySummary(hit.entry),
      snippet: hit.snippet,
      score: hit.score,
    })),
  }
}
