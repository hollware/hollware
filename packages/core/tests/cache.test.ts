import { describe, expect, it } from 'vite-plus/test'

import {
  entryTag,
  groupTag,
  listTag,
  tagsOfChange,
  tagsOfEntries,
  tagsOfSiteChange,
} from '../src/cache.ts'

const ENTRY = {
  id: 'ent_01JAB3XQ8ZK4M6N2P5R7S9T0VW',
  collection: 'blog',
  locale: 'es',
  translationGroup: 'hola, mundo',
}

describe('cache tags', () => {
  it('name an entry, a list and a group, in the characters a tag may hold', () => {
    expect(entryTag(ENTRY.id)).toBe('entry:ent_01JAB3XQ8ZK4M6N2P5R7S9T0VW')
    expect(listTag('blog', 'es-CL')).toBe('list:blog:es-CL')
    expect(groupTag('blog', "l'été, déjà")).toBe('group:blog:l%27%C3%A9t%C3%A9%2C%20d%C3%A9j%C3%A0')
    expect(groupTag('blog', 'x'.repeat(2000))).toHaveLength(1024)
  })

  it('of a change are the entry, its list and its group; of a page, each entry once', () => {
    expect(tagsOfChange(ENTRY)).toEqual([
      'entry:ent_01JAB3XQ8ZK4M6N2P5R7S9T0VW',
      'list:blog:es',
      'list:blog:*',
      'group:blog:hola%2C%20mundo',
    ])
    expect(tagsOfChange({ ...ENTRY, translationGroup: null })).toHaveLength(3)
    expect(tagsOfEntries([ENTRY, ENTRY])).toEqual(['entry:ent_01JAB3XQ8ZK4M6N2P5R7S9T0VW'])
  })

  it('purges the site and every list of its collections when its structure changes', () => {
    expect(tagsOfSiteChange(['blog', 'talks'], ['es', 'en'])).toEqual([
      'site',
      'list:blog:es',
      'list:blog:en',
      'list:blog:*',
      'list:talks:es',
      'list:talks:en',
      'list:talks:*',
    ])
    expect(tagsOfSiteChange([], ['en'])).toEqual(['site'])
  })
})
