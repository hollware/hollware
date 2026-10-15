/**
 * Semantic search (v0.5) stands on two services that have no local emulation: a model that turns
 * text into vectors, and an index that finds the nearest ones. Both are ports, so that tests use
 * deterministic fakes and a deployment without them has no semantic search at all.
 */

/** Turns texts into vectors, all of the same length. */
export interface Embedder {
  /** The model, which the stored vectors name: another model makes them stale. */
  readonly model: string
  embed(texts: readonly string[]): Promise<number[][]>
}

/** What a vector says about where it comes from, to filter and to read a match back. */
export interface VectorMetadata {
  readonly site: string
  readonly entry: string
  readonly collection: string
  readonly locale: string
  /** The piece of the entry: 0 for its summary. */
  readonly piece: number
}

export interface StoredVector {
  /** `<entry id>:<piece>`. */
  readonly id: string
  readonly values: readonly number[]
  readonly metadata: VectorMetadata
}

export interface VectorMatch {
  readonly id: string
  /** How close: higher is closer. */
  readonly score: number
  readonly metadata: VectorMetadata
}

export interface VectorIndex {
  upsert(vectors: readonly StoredVector[]): Promise<void>
  remove(ids: readonly string[]): Promise<void>
  /** The `topK` vectors nearest to `values` among those of the site, narrowed as asked. */
  query(
    values: readonly number[],
    options: {
      readonly topK: number
      readonly site: string
      readonly collection?: string
      readonly locale?: string
      /** Only the summaries, one vector per entry. */
      readonly summariesOnly?: boolean
    },
  ): Promise<readonly VectorMatch[]>
}

/** What semantic search needs: both services, or the deployment has none. */
export interface Semantic {
  readonly embedder: Embedder
  readonly index: VectorIndex
}

/** The id of a piece's vector. */
export function vectorId(entryId: string, piece: number): string {
  return `${entryId}:${piece}`
}
