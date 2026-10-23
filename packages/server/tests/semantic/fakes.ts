import type { Embedder, Semantic, StoredVector, VectorIndex, VectorMatch } from '../../src/ports.ts'

export function fakeEmbedder(model = 'fake-model'): Embedder & { readonly calls: string[][] } {
  const calls: string[][] = []
  return {
    model,
    calls,
    async embed(texts) {
      calls.push([...texts])
      return texts.map((text) => {
        const counts = Array.from({ length: 26 }, () => 0)
        for (const letter of text.toLowerCase()) {
          const at = letter.charCodeAt(0) - 97
          if (at >= 0 && at < 26) counts[at] = (counts[at] ?? 0) + 1
        }
        return counts
      })
    },
  }
}

function cosine(a: readonly number[], b: readonly number[]): number {
  let dot = 0
  let normA = 0
  let normB = 0
  for (let at = 0; at < a.length; at++) {
    dot += (a[at] ?? 0) * (b[at] ?? 0)
    normA += (a[at] ?? 0) ** 2
    normB += (b[at] ?? 0) ** 2
  }
  return normA === 0 || normB === 0 ? 0 : dot / Math.sqrt(normA * normB)
}

export function fakeIndex(): VectorIndex & { readonly vectors: Map<string, StoredVector> } {
  const vectors = new Map<string, StoredVector>()
  return {
    vectors,
    async upsert(list) {
      for (const vector of list) vectors.set(vector.id, vector)
    },
    async remove(ids) {
      for (const id of ids) vectors.delete(id)
    },
    async get(ids) {
      return ids.flatMap((id) => {
        const vector = vectors.get(id)
        return vector === undefined ? [] : [{ id, values: vector.values }]
      })
    },
    async query(values, options) {
      const matches: VectorMatch[] = []
      for (const vector of vectors.values()) {
        const { metadata } = vector
        if (metadata.site !== options.site) continue
        if (options.collection !== undefined && metadata.collection !== options.collection) continue
        if (options.locale !== undefined && metadata.locale !== options.locale) continue
        if (options.summariesOnly === true && metadata.piece !== 0) continue
        matches.push({ id: vector.id, score: cosine(values, vector.values), metadata })
      }
      return matches.sort((a, b) => b.score - a.score).slice(0, options.topK)
    },
  }
}

export function fakeSemantic(model?: string) {
  const embedder = fakeEmbedder(model)
  const index = fakeIndex()
  const semantic: Semantic = { embedder, index }
  return { semantic, embedder, index }
}
