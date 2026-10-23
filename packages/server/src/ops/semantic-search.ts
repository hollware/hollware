import type { ContentStore, SearchHit, SearchQuery, Semantic, VectorMatch } from '../ports.ts'

export const SEMANTIC_TOP_K = 20

export const FUSION_K = 60

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
              ...(kept.piece === undefined && hit.piece !== undefined ? { piece: hit.piece } : {}),
            },
      )
    })
  }
  return [...merged.values()].sort((a, b) => b.score - a.score).slice(0, limit)
}
