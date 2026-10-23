import { describe, expect, it } from 'vite-plus/test'

import { fuse } from '../../src/ops/semantic-search.ts'
import type { EntrySummaryView, SearchHit } from '../../src/ports.ts'

function hit(id: string, snippet: string): SearchHit {
  const entry: EntrySummaryView = {
    entry: {
      id,
      collection: 'blog',
      locale: 'en',
      slug: id,
      translationGroup: null,
      status: 'published',
      version: 2,
      headRevision: `rev_${id}`,
      publishedRevision: `rev_${id}`,
      publishedAt: '2026-10-15T10:00:00.000Z',
      scheduledAt: null,
      deletedAt: null,
      updatedAt: '2026-10-15T10:00:00.000Z',
    },
    revision: {
      id: `rev_${id}`,
      frontmatter: {},
      tags: [],
      wordCount: 0,
      codeWords: 0,
      createdAt: '',
    },
  }
  return { entry, snippet, score: 0 }
}

describe('fuse', () => {
  it('adds up the places of an entry in every list, and keeps the first snippet', () => {
    const words = [hit('a', 'a by words'), hit('b', 'b by words')]
    const meaning = [hit('c', 'c by meaning'), hit('b', 'b by meaning')]

    const fused = fuse([words, meaning], 10)

    expect(fused.map((one) => [one.entry.entry.id, one.snippet, one.score])).toEqual([
      ['b', 'b by words', 2 / 62],
      ['a', 'a by words', 1 / 61],
      ['c', 'c by meaning', 1 / 61],
    ])
    expect(fuse([words, meaning], 1).map((one) => one.entry.entry.id)).toEqual(['b'])
  })
})
