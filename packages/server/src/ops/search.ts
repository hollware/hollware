import { entrySummary } from './answers.ts'
import { forReaders } from './assets.ts'
import { requireCollection, requireLocale } from './collections.ts'
import type { OperationHandler } from './types.ts'
import { fuse, semanticSearch, SEMANTIC_TOP_K } from './semantic-search.ts'

/**
 * The published entries of the site that match the query, best first: by its words, by meaning,
 * or both (ADR-030). Without the semantic search of the deployment, every mode is full text, and
 * the answer's `mode` says which one ran.
 */
export const search: OperationHandler<'search'> = async (input, context) => {
  if (input.collection !== undefined) requireCollection(context.site, input.collection)
  if (input.locale !== undefined) requireLocale(context.site, input.locale)
  const query = {
    text: input.query,
    collection: input.collection,
    locale: input.locale,
    limit: input.limit,
  }
  const semantic = context.semantic ?? null
  const asked = input.mode ?? 'hybrid'
  const mode = semantic === null ? 'fulltext' : asked
  const site = context.site.key
  let hits
  if (semantic === null || mode === 'fulltext') {
    hits = await context.store.searchEntries(site, query)
  } else if (mode === 'semantic') {
    hits = await semanticSearch(semantic, context.store, site, query)
  } else {
    // Each list longer than the answer, so that an entry low in one can rise with the other.
    const wide = { ...query, limit: Math.max(query.limit, SEMANTIC_TOP_K) }
    const [words, meaning] = await Promise.all([
      context.store.searchEntries(site, wide),
      semanticSearch(semantic, context.store, site, wide),
    ])
    hits = fuse([words, meaning], query.limit)
  }
  return {
    outcome: 'ok',
    mode,
    results: hits.map((hit) => ({
      entry: forReaders(context, entrySummary(hit.entry)),
      snippet: hit.snippet,
      score: hit.score,
    })),
  }
}
