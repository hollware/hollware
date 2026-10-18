import type { ContentStore, SearchHit, SearchQuery, Semantic, VectorMatch } from '../ports.ts'

/**
 * How many pieces a semantic search asks the index for: Vectorize answers at most 20 with their
 * metadata, and the best piece of each entry stands for it.
 */
export const SEMANTIC_TOP_K = 20

/** The constant of reciprocal rank fusion: how little the first places weigh over the next. */
export const FUSION_K = 60

/** The published entries closest to the meaning of the query, closest first. */
export async function semanticSearch(
  semantic: Semantic,
  store: ContentStore,
  site: string,
  query: SearchQuery,
): Promise<readonly SearchHit[]> {
  const [vector] = await semantic.embedder.embed([query.text])
  const matches = await semantic.index.query(vector ?? [], {
    topK: SEMANTIC_TOP_K,
    site,
    ...(query.collection === undefined ? {} : { collection: query.collection }),
    ...(query.locale === undefined ? {} : { locale: query.locale }),
  })
  const best = new Map<string, VectorMatch>()
  for (const match of matches) {
    const kept = best.get(match.metadata.entry)
    if (kept === undefined || match.score > kept.score) best.set(match.metadata.entry, match)
  }
  const ranked = [...best.values()]
    .filter((match) => query.minScore === undefined || match.score >= query.minScore)
    .sort((a, b) => b.score - a.score)
    .slice(0, query.limit)
  // An entry unpublished since its vectors were made is not in the published view.
  const summaries = await store.findSummaries(
    site,
    ranked.map((match) => match.metadata.entry),
    'published',
  )
  const byId = new Map(summaries.map((summary) => [summary.entry.id, summary]))
  return ranked.flatMap((match) => {
    const entry = byId.get(match.metadata.entry)
    return entry === undefined
      ? []
      : [
          {
            entry,
            snippet: match.metadata.excerpt,
            score: match.score,
            piece: match.metadata.piece,
          },
        ]
  })
}

/**
 * Merges rankings by reciprocal rank fusion: an entry scores `1 / (FUSION_K + place)` in each list
 * it is in, places counted from 1. An entry keeps the snippet of the first list that has it, so
 * the words found by full text win over the excerpt of a match by meaning.
 */
export function fuse(lists: readonly (readonly SearchHit[])[], limit: number): SearchHit[] {
  const merged = new Map<string, SearchHit>()
  for (const list of lists) {
    list.forEach((hit, place) => {
      const gain = 1 / (FUSION_K + place + 1)
      const kept = merged.get(hit.entry.entry.id)
      merged.set(
        hit.entry.entry.id,
        kept === undefined
          ? { ...hit, score: gain }
          : {
              ...kept,
              score: kept.score + gain,
              // The piece a match by meaning found, for the passage, when full text found none.
              ...(kept.piece === undefined && hit.piece !== undefined ? { piece: hit.piece } : {}),
            },
      )
    })
  }
  return [...merged.values()].sort((a, b) => b.score - a.score).slice(0, limit)
}
