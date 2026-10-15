import type { Embedder, Semantic, VectorIndex, VectorMetadata } from '../ports.ts'

/** The embedding model when the config names none: multilingual, so Spanish finds English. */
export const DEFAULT_EMBEDDING_MODEL = '@cf/baai/bge-m3'

interface AiBinding {
  run(model: string, input: { text: string[] }): Promise<unknown>
}

interface VectorizeBinding {
  upsert(
    vectors: {
      id: string
      values: number[]
      metadata: Record<string, string | number | boolean>
    }[],
  ): Promise<unknown>
  deleteByIds(ids: string[]): Promise<unknown>
  query(
    vector: number[],
    options: {
      topK: number
      filter?: Record<string, string | number | boolean>
      returnMetadata?: 'all' | 'indexed' | 'none'
    },
  ): Promise<{ matches: { id: string; score: number; metadata?: Record<string, unknown> }[] }>
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** Workers AI as an embedder: `{ data: number[][] }` for a batch of texts. */
export function workersAiEmbedder(ai: AiBinding, model: string): Embedder {
  return {
    model,
    async embed(texts) {
      if (texts.length === 0) return []
      const answer = await ai.run(model, { text: [...texts] })
      const data = isRecord(answer) ? answer['data'] : undefined
      if (!Array.isArray(data) || data.length !== texts.length) {
        throw new Error(`${model} answered no vector for each of ${texts.length} texts`)
      }
      return data.map((vector) => {
        if (!Array.isArray(vector)) throw new Error(`${model} answered a vector that is no list`)
        return vector.map(Number)
      })
    },
  }
}

function metadataOf(raw: Record<string, unknown> | undefined): VectorMetadata | null {
  if (raw === undefined) return null
  const { site, entry, collection, locale, piece, excerpt } = raw
  if (
    typeof excerpt !== 'string' ||
    typeof site !== 'string' ||
    typeof entry !== 'string' ||
    typeof collection !== 'string' ||
    typeof locale !== 'string' ||
    typeof piece !== 'number'
  ) {
    return null
  }
  return { site, entry, collection, locale, piece, excerpt }
}

/** Vectorize as the index. Its metadata indexes on site, collection, locale and piece filter. */
export function vectorizeIndex(binding: VectorizeBinding): VectorIndex {
  return {
    async upsert(vectors) {
      if (vectors.length === 0) return
      await binding.upsert(
        vectors.map((vector) => ({
          id: vector.id,
          values: [...vector.values],
          metadata: { ...vector.metadata },
        })),
      )
    },
    async remove(ids) {
      if (ids.length > 0) await binding.deleteByIds([...ids])
    },
    async query(values, options) {
      const answer = await binding.query([...values], {
        topK: options.topK,
        returnMetadata: 'all',
        filter: {
          site: options.site,
          ...(options.collection === undefined ? {} : { collection: options.collection }),
          ...(options.locale === undefined ? {} : { locale: options.locale }),
          ...(options.summariesOnly === true ? { piece: 0 } : {}),
        },
      })
      return answer.matches.flatMap((match) => {
        const metadata = metadataOf(match.metadata)
        return metadata === null ? [] : [{ id: match.id, score: match.score, metadata }]
      })
    },
  }
}

/** Semantic search over the Worker's bindings, or `null` when it does not have both. */
export function semanticOf(env: object, model: string): Semantic | null {
  const ai: unknown = Reflect.get(env, 'AI')
  const vectorize: unknown = Reflect.get(env, 'VECTORIZE')
  if (!isRecord(ai) || typeof ai['run'] !== 'function') return null
  if (!isRecord(vectorize) || typeof vectorize['query'] !== 'function') return null
  return {
    embedder: workersAiEmbedder(ai as unknown as AiBinding, model),
    index: vectorizeIndex(vectorize as unknown as VectorizeBinding),
  }
}

/** Semantic search over the Worker's bindings with the deployment's model, or `null` without. */
export function semanticOfEnv(env: object): Semantic | null {
  return semanticOf(env, DEFAULT_EMBEDDING_MODEL)
}
