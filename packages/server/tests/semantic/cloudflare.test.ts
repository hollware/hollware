import { describe, expect, it } from 'vite-plus/test'

import {
  semanticOf,
  semanticOfEnv,
  vectorizeIndex,
  workersAiEmbedder,
} from '../../src/semantic/cloudflare.ts'

function fakeAi(answer: unknown) {
  const runs: { model: string; input: unknown }[] = []
  return {
    runs,
    async run(model: string, input: { text: string[] }) {
      runs.push({ model, input })
      return answer
    },
  }
}

function fakeVectorize(
  matches: { id: string; score: number; metadata?: Record<string, unknown> }[],
) {
  const queries: { vector: number[]; options: unknown }[] = []
  const deleted: string[][] = []
  const fetched: string[][] = []
  return {
    queries,
    deleted,
    fetched,
    async getByIds(ids: string[]) {
      fetched.push(ids)
      return ids
        .filter((id) => id !== 'gone')
        .map((id) => ({ id, values: new Float32Array([0.5, 0.25]) }))
    },
    async upsert() {
      return {}
    },
    async deleteByIds(ids: string[]) {
      deleted.push(ids)
      return {}
    },
    async query(vector: number[], options: unknown) {
      queries.push({ vector, options })
      return { matches }
    },
  }
}

const METADATA = {
  site: 'blog',
  entry: 'ent_1',
  collection: 'posts',
  locale: 'en',
  piece: 0,
  excerpt: 'Caching at the edge',
}

describe('the Workers AI embedder', () => {
  it('asks the model for every text at once and answers its vectors', async () => {
    const ai = fakeAi({
      shape: [2, 2],
      data: [
        [1, 2],
        [3, 4],
      ],
    })

    const vectors = await workersAiEmbedder(ai, '@cf/baai/bge-m3').embed(['one', 'two'])

    expect(vectors).toEqual([
      [1, 2],
      [3, 4],
    ])
    expect(ai.runs).toEqual([{ model: '@cf/baai/bge-m3', input: { text: ['one', 'two'] } }])
  })

  it('refuses an answer without a vector per text, and asks nothing for no text', async () => {
    const ai = fakeAi({ data: [[1, 2]] })
    const embedder = workersAiEmbedder(ai, 'model')

    await expect(embedder.embed(['one', 'two'])).rejects.toThrow(
      'model answered no vector for each of 2 texts',
    )
    expect(await embedder.embed([])).toEqual([])
    expect(ai.runs).toHaveLength(1)
  })
})

describe('the Vectorize index', () => {
  it('narrows a query to the site, and to what is asked', async () => {
    const vectorize = fakeVectorize([])
    const index = vectorizeIndex(vectorize)

    await index.query([1], { topK: 5, site: 'blog' })
    await index.query([1], {
      topK: 3,
      site: 'blog',
      collection: 'posts',
      locale: 'es',
      summariesOnly: true,
    })

    expect(vectorize.queries.map((query) => query.options)).toEqual([
      { topK: 5, returnMetadata: 'all', filter: { site: 'blog' } },
      {
        topK: 3,
        returnMetadata: 'all',
        filter: { site: 'blog', collection: 'posts', locale: 'es', piece: 0 },
      },
    ])
  })

  it('answers the matches whose metadata is Hollware’s, and only those', async () => {
    const index = vectorizeIndex(
      fakeVectorize([
        { id: 'ent_1:0', score: 0.9, metadata: METADATA },
        { id: 'stranger', score: 0.8, metadata: { site: 'blog' } },
        { id: 'bare', score: 0.7 },
      ]),
    )

    expect(await index.query([1], { topK: 5, site: 'blog' })).toEqual([
      { id: 'ent_1:0', score: 0.9, metadata: METADATA },
    ])
  })

  it('removes by id, and calls nothing for no id', async () => {
    const vectorize = fakeVectorize([])
    const index = vectorizeIndex(vectorize)

    await index.remove([])
    await index.remove(['ent_1:0', 'ent_1:1'])

    expect(vectorize.deleted).toEqual([['ent_1:0', 'ent_1:1']])
  })
})

describe('the Vectorize index, read back', () => {
  it('answers the values of the vectors it has, as numbers, and asks nothing for no id', async () => {
    const vectorize = fakeVectorize([])
    const index = vectorizeIndex(vectorize)

    expect(await index.get([])).toEqual([])
    expect(await index.get(['ent_1:0', 'gone'])).toEqual([{ id: 'ent_1:0', values: [0.5, 0.25] }])
    expect(vectorize.fetched).toEqual([['ent_1:0', 'gone']])
  })
})

describe('semanticOf', () => {
  it('needs both bindings', () => {
    const ai = fakeAi({ data: [] })
    const vectorize = fakeVectorize([])

    expect(semanticOf({}, 'model')).toBeNull()
    expect(semanticOf({ AI: ai }, 'model')).toBeNull()
    expect(semanticOf({ VECTORIZE: vectorize }, 'model')).toBeNull()
    expect(semanticOf({ AI: ai, VECTORIZE: vectorize }, 'model')?.embedder.model).toBe('model')
  })
})

describe('semanticOfEnv', () => {
  it('takes the model of HOLLWARE_EMBEDDING_MODEL, and bge-m3 without it', () => {
    const bindings = { AI: fakeAi({ data: [] }), VECTORIZE: fakeVectorize([]) }

    expect(semanticOfEnv(bindings)?.embedder.model).toBe('@cf/baai/bge-m3')
    expect(
      semanticOfEnv({ ...bindings, HOLLWARE_EMBEDDING_MODEL: '@cf/qwen/qwen3-embedding-0.6b' })
        ?.embedder.model,
    ).toBe('@cf/qwen/qwen3-embedding-0.6b')
  })
})
