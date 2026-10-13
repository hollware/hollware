import { describe, expect, it } from 'vite-plus/test'

import { sortKeyOf, tagsOf, translationGroupOf } from '../../src/ops/draft.ts'
import { blogSite } from './support.ts'

// Fails when: draft.ts reads the translation group, the tags or the sort key from anything else
// than the field that the collection names, takes a value that is not a string (or a list of
// strings) for one, or takes the empty string for a translation group. The Markdown pipeline
// returns the frontmatter as YAML gave it, before the schema looked at it, so these have to
// survive any value.

const site = blogSite('fields-site')
const blog = site.collections.get('blog')
const notes = site.collections.get('notes')
if (blog === undefined || notes === undefined) throw new Error('the test site lost a collection')

describe('translationGroupOf', () => {
  it.each([
    ['a string', { translationGroup: 'edge-caching' }, 'edge-caching'],
    ['an empty string, which is no group', { translationGroup: '' }, null],
    ['a number', { translationGroup: 5 }, null],
    ['a list', { translationGroup: ['edge-caching'] }, null],
    ['an object', { translationGroup: { name: 'edge-caching' } }, null],
    ['null', { translationGroup: null }, null],
    ['nothing', {}, null],
    ['a field of another name', { group: 'edge-caching' }, null],
  ])(
    'is the value of the field the collection names when it is a string, not %s',
    (_what, frontmatter, group) => {
      expect(translationGroupOf(blog, frontmatter)).toBe(group)
    },
  )

  it('is none for a collection that names no field, whatever the frontmatter has', () => {
    expect(translationGroupOf(notes, { translationGroup: 'edge-caching', group: 'x' })).toBeNull()
  })
})

describe('tagsOf', () => {
  it.each([
    ['a list of strings', { tags: ['cloudflare', 'cms'] }, ['cloudflare', 'cms']],
    ['an empty list', { tags: [] }, []],
    ['a list with something that is not a string', { tags: ['cloudflare', 1] }, []],
    ['a list of lists', { tags: [['cloudflare']] }, []],
    ['a string', { tags: 'cloudflare' }, []],
    ['null', { tags: null }, []],
    ['nothing', {}, []],
    ['a field of another name', { keywords: ['cloudflare'] }, []],
  ])(
    'is the value of the field the collection names when it is a list of strings, not %s',
    (_what, frontmatter, tags) => {
      expect(tagsOf(blog, frontmatter)).toEqual(tags)
    },
  )

  it('is none for a collection that names no field, whatever the frontmatter has', () => {
    expect(tagsOf(notes, { tags: ['cloudflare'] })).toEqual([])
  })
})

describe('sortKeyOf', () => {
  it.each([
    ['a string', { date: '2026-09-01' }, '2026-09-01'],
    ['a number', { date: 20260901 }, null],
    ['null', { date: null }, null],
    ['a list', { date: ['2026-09-01'] }, null],
    ['nothing', {}, null],
    ['a field of another name', { published: '2026-09-01' }, null],
  ])(
    'is the value of the field the collection names when it is a string, not %s',
    (_what, frontmatter, key) => {
      expect(sortKeyOf(blog, frontmatter)).toBe(key)
    },
  )

  it('is none for a collection that names no field, whatever the frontmatter has', () => {
    expect(sortKeyOf(notes, { date: '2026-09-01' })).toBeNull()
  })
})
