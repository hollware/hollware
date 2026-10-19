import { describe, expect, it } from 'vite-plus/test'

import { forPage } from '../src/runtime/server/answer.ts'

// Fails when forPage (src/runtime/server/answer.ts) lets the verdict, the revision or the last
// publication of an entry reach a page, which sends what it read to the browser, or drops what a
// reader sees: its frontmatter, its document, or the images <HollwareImage> lays out.

describe('an entry for a page', () => {
  it('keeps what a reader sees, its images included, and nothing of how it was checked', () => {
    const images = { 'https://cms.test/a': { width: 800, height: 600, srcset: null, alt: 'A' } }
    expect(
      forPage({
        id: 'ent_1',
        slug: 'hello',
        frontmatter: { title: 'Hello', img: 'https://cms.test/a' },
        document: { nodes: [] },
        images,
        verdict: { ok: true },
        revision: 'rev_1',
        lastPublication: null,
      }),
    ).toEqual({
      id: 'ent_1',
      slug: 'hello',
      frontmatter: { title: 'Hello', img: 'https://cms.test/a' },
      document: { nodes: [] },
      images,
    })
  })
})
