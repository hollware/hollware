import { describe, expect, it } from 'vite-plus/test'

import { liveEntryOf, withLiveEntry } from '../src/runtime/live.ts'

describe('the entry the admin sends to a page in its live preview', () => {
  it('takes the fields a page reads from a message of Hollware, and nothing else', () => {
    expect(
      liveEntryOf({
        type: 'hollware:preview-entry',
        entry: {
          id: 'ent_1',
          frontmatter: { title: 'Live' },
          document: { nodes: [['p', {}, 'Now']] },
          verdict: 'pass',
          revision: 'rev_1',
        },
      }),
    ).toEqual({
      id: 'ent_1',
      frontmatter: { title: 'Live' },
      document: { nodes: [['p', {}, 'Now']] },
    })
  })

  it('answers null for any other message, and for an entry without an id', () => {
    expect(liveEntryOf({ type: 'other', entry: { id: 'ent_1' } })).toBeNull()
    expect(liveEntryOf({ type: 'hollware:preview-entry', entry: { slug: 'a' } })).toBeNull()
    expect(liveEntryOf('hollware:preview-entry')).toBeNull()
  })

  it('puts the entry in place of the one a page read with the same id, keeping what it does not send', () => {
    const read = {
      outcome: 'ok',
      entry: {
        id: 'ent_1',
        slug: 'risk',
        frontmatter: { title: 'Saved' },
        document: { nodes: [] },
      },
      ancestors: [],
    }
    const live = { id: 'ent_1', frontmatter: { title: 'Live' }, document: { nodes: ['Now'] } }

    expect(withLiveEntry(read, live)).toEqual({
      outcome: 'ok',
      entry: {
        id: 'ent_1',
        slug: 'risk',
        frontmatter: { title: 'Live' },
        document: { nodes: ['Now'] },
      },
      ancestors: [],
    })
    expect(withLiveEntry({ outcome: 'ok', entry: { id: 'ent_2' } }, live)).toBeNull()
    expect(withLiveEntry({ outcome: 'ok', entries: [] }, live)).toBeNull()
    expect(withLiveEntry(null, live)).toBeNull()
  })
})
