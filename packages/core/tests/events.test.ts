import { describe, expect, it } from 'vite-plus/test'

import { parseHollwareEvent } from '../src/events.ts'

// Fails when: a receiver of webhooks (src/events.ts) stops reading the events Hollware sends, an
// entry's and a site's, with every field; or starts taking a body that is no event, an event of a
// kind it does not know, or an entry event without its entry, instead of answering null.

const ENTRY = {
  id: 'evt_01JAB3XQ8ZK4M6N2P5R7S9T0VW',
  kind: 'entry.published',
  site: 'blog',
  at: '2026-10-16T12:00:00.000Z',
  entry: {
    id: 'ent_01JAB3XQ8ZK4M6N2P5R7S9T0VW',
    collection: 'posts',
    locale: 'en',
    slug: 'hello-world',
    translationGroup: null,
  },
  path: '/blog/hello-world/',
  url: 'https://example.com/blog/hello-world/',
  cacheTags: ['entry:ent_01JAB3XQ8ZK4M6N2P5R7S9T0VW', 'list:posts:en', 'list:posts:*'],
}
const SITE = {
  id: 'evt_01JAB3XQ8ZK4M6N2P5R7S9T0VX',
  kind: 'site.changed',
  site: 'blog',
  at: '2026-10-16T12:00:00.000Z',
  cacheTags: ['site', 'list:posts:en', 'list:posts:*'],
}

describe('parseHollwareEvent', () => {
  it('reads the event of an entry and the event of a site', () => {
    expect(parseHollwareEvent(JSON.stringify(ENTRY))).toEqual(ENTRY)
    expect(parseHollwareEvent(JSON.stringify(SITE))).toEqual(SITE)
  })

  it('answers null for a body that is no event of this version', () => {
    expect(parseHollwareEvent('not json')).toBe(null)
    expect(parseHollwareEvent(JSON.stringify({ ...SITE, kind: 'site.renamed' }))).toBe(null)
    const { entry: _gone, ...noEntry } = ENTRY
    expect(parseHollwareEvent(JSON.stringify(noEntry))).toBe(null)
  })
})
