import { describe, expect, it } from 'vite-plus/test'

import { propEntries, propsFrom } from '../app/lib/editor/components.ts'
import { groupRows, matches, nextIndex, toggled, visibleRows } from '../app/lib/entry-list.ts'
import { settingsSections } from '../app/lib/settings.ts'

const row = (
  id: string,
  status: 'draft' | 'scheduled' | 'published',
  updatedAt: string,
  deletedAt: string | null = null,
) => ({
  id,
  status,
  updatedAt,
  deletedAt,
})

describe('the list of entries', () => {
  it('groups drafts, then scheduled, then published, then the trash, each newest first', () => {
    const groups = groupRows([
      row('a', 'published', '2026-10-01'),
      row('b', 'draft', '2026-10-02'),
      row('c', 'draft', '2026-10-05'),
      row('d', 'draft', '2026-10-09', '2026-10-10'),
      row('e', 'scheduled', '2026-10-03'),
    ])
    expect(groups.map(({ key, rows }) => [key, rows.map(({ id }) => id)])).toEqual([
      ['draft', ['c', 'b']],
      ['scheduled', ['e']],
      ['published', ['a']],
      ['trash', ['d']],
    ])
    expect(visibleRows(groups, new Set(['draft', 'trash'])).map(({ id }) => id)).toEqual(['e', 'a'])
  })

  it('moves through the rows with the keyboard and stops at both ends', () => {
    expect(nextIndex(-1, 3, 1)).toBe(0)
    expect(nextIndex(-1, 3, -1)).toBe(2)
    expect(nextIndex(2, 3, 1)).toBe(2)
    expect(nextIndex(0, 3, -1)).toBe(0)
    expect(nextIndex(0, 0, 1)).toBe(-1)
    expect(toggled(['a'], 'b')).toEqual(['a', 'b'])
    expect(toggled(['a', 'b'], 'a')).toEqual(['b'])
  })

  it('finds an entry by its title, its slug or a tag, whatever the case', () => {
    const entry = { title: 'Edge caching', slug: 'edge-cache', tags: ['Cloudflare'] }
    expect(matches(entry, 'CACHING')).toBe(true)
    expect(matches(entry, 'edge-cache')).toBe(true)
    expect(matches(entry, 'cloud')).toBe(true)
    expect(matches(entry, 'workers')).toBe(false)
    expect(matches(entry, '  ')).toBe(true)
  })
})

describe('the props of a component in the editor', () => {
  const schema = {
    type: 'object',
    properties: {
      type: { type: 'string', description: 'The tone of it' },
      count: { type: 'integer' },
    },
  }

  it('lists what is given and what the collection allows, typed props written with a colon', () => {
    expect(propEntries({ type: 'tip', extra: 'x' }, schema)).toEqual([
      { key: 'type', label: 'type', description: 'The tone of it', value: 'tip' },
      { key: 'extra', label: 'extra', description: null, value: 'x' },
      { key: ':count', label: 'count', description: null, value: '' },
    ])
  })

  it('keeps the props that have a value, and none when every one is empty', () => {
    expect(
      propsFrom([
        { key: 'type', label: 'type', description: null, value: 'tip' },
        { key: ':count', label: 'count', description: null, value: ' ' },
      ]),
    ).toEqual({ type: 'tip' })
    expect(propsFrom([{ key: 'type', label: 'type', description: null, value: '' }])).toBeNull()
  })
})

describe('the sections of the settings', () => {
  it('show the activity log to an owner only', () => {
    expect(settingsSections(true).map(({ key }) => key)).toEqual([
      'site',
      'collections',
      'people',
      'tokens',
      'activity',
      'account',
    ])
    expect(settingsSections(false).map(({ key }) => key)).not.toContain('activity')
  })
})
