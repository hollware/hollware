import { describe, expect, it } from 'vite-plus/test'

import type { EntryDocument } from '../../src/markdown/types.ts'
import { CHUNK_LIMITS, CHUNKER_VERSION, chunksOf } from '../../src/search/chunks.ts'

const document = (nodes: EntryDocument['nodes']): EntryDocument => ({
  frontmatter: {},
  meta: {},
  nodes,
})

describe('chunksOf', () => {
  it('makes a summary and one piece per h2 section, in order', () => {
    const chunks = chunksOf({
      title: 'Caching at the edge',
      description: 'Why reads are fast.',
      document: document([
        ['h1', { id: 'caching' }, 'Caching at the edge'],
        ['p', {}, 'Workers answer ', ['strong', {}, 'close'], ' to the reader.'],
        ['h2', { id: 'how' }, 'How it works'],
        ['p', { class: 'note' }, 'The cache keeps a copy.'],
        ['ul', {}, ['li', {}, 'One'], ['li', {}, 'Two']],
        ['h2', { id: 'empty' }, 'Nothing here'],
        ['h2', { id: 'why' }, 'Why'],
        [null, {}, 'a comment'],
        ['p', {}, ['a', { href: '/hidden/' }, 'Speed'], '.'],
      ]),
    })

    expect(chunks).toEqual([
      {
        index: 0,
        kind: 'summary',
        heading: null,
        text: 'Caching at the edge Why reads are fast. Workers answer close to the reader.',
      },
      {
        index: 1,
        kind: 'section',
        heading: 'How it works',
        text: 'How it works The cache keeps a copy. OneTwo',
      },
      { index: 2, kind: 'section', heading: 'Why', text: 'Why Speed.' },
    ])
  })

  it('cuts a piece at the last word within its limit', () => {
    const word = 'harbour '
    const long = word.repeat(Math.ceil(CHUNK_LIMITS.section / word.length) + 10)
    const [, section] = chunksOf({
      title: 'Long',
      document: document([
        ['h2', {}, 'Heading'],
        ['p', {}, long],
      ]),
    })

    expect(section?.text.length).toBeLessThanOrEqual(CHUNK_LIMITS.section)
    expect(section?.text.endsWith('harbour')).toBe(true)
    expect(section?.text.length).toBeGreaterThan(CHUNK_LIMITS.section - word.length)
  })

  it('makes a summary of the title alone for an entry with no body', () => {
    expect(chunksOf({ title: 'Only a title', document: document([]) })).toEqual([
      { index: 0, kind: 'summary', heading: null, text: 'Only a title' },
    ])
  })

  it('is version 1', () => {
    expect(CHUNKER_VERSION).toBe('1')
  })
})
