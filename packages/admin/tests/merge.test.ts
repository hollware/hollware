import { describe, expect, it } from 'vite-plus/test'

import { mergeText } from '../app/lib/merge.ts'

const BASE = [
  '# Title',
  '',
  'First paragraph.',
  '',
  'Second paragraph.',
  '',
  'Third paragraph.',
].join('\n')

describe('merging two edits of the same entry', () => {
  it('keeps both when they change different paragraphs', () => {
    const mine = BASE.replace('First paragraph.', 'First paragraph, mine.')
    const theirs = BASE.replace('Third paragraph.', 'Third paragraph, theirs.')

    expect(mergeText(BASE, mine, theirs, 'mine')).toEqual({
      text: [
        '# Title',
        '',
        'First paragraph, mine.',
        '',
        'Second paragraph.',
        '',
        'Third paragraph, theirs.',
      ].join('\n'),
      conflicts: 0,
    })
  })

  it('keeps a paragraph one added and a paragraph the other removed', () => {
    const mine = `${BASE}\n\nA new closing paragraph.`
    const theirs = BASE.replace('\n\nSecond paragraph.', '')

    expect(mergeText(BASE, mine, theirs, 'theirs')).toEqual({
      text: [
        '# Title',
        '',
        'First paragraph.',
        '',
        'Third paragraph.',
        '',
        'A new closing paragraph.',
      ].join('\n'),
      conflicts: 0,
    })
  })

  it('takes the same change once when both made it', () => {
    const both = BASE.replace('Second paragraph.', 'Second, fixed.')

    expect(mergeText(BASE, both, both, 'mine')).toEqual({ text: both, conflicts: 0 })
  })

  it('counts a line both changed differently, and settles it for the side asked', () => {
    const mine = BASE.replace('Second paragraph.', 'Second, as I wrote it.')
    const theirs = BASE.replace('Second paragraph.', 'Second, as they wrote it.').replace(
      '# Title',
      '# Their title',
    )

    expect(mergeText(BASE, mine, theirs, 'mine')).toEqual({
      text: [
        '# Their title',
        '',
        'First paragraph.',
        '',
        'Second, as I wrote it.',
        '',
        'Third paragraph.',
      ].join('\n'),
      conflicts: 1,
    })
    expect(mergeText(BASE, mine, theirs, 'theirs').text).toBe(theirs)
  })

  it('counts as a clash two paragraphs added at the same place', () => {
    const mine = BASE.replace('Second paragraph.', 'Second paragraph.\n\nMine, added.')
    const theirs = BASE.replace('Second paragraph.', 'Second paragraph.\n\nTheirs, added.')

    expect(mergeText(BASE, mine, theirs, 'theirs')).toEqual({ text: theirs, conflicts: 1 })
  })

  it('answers the other side untouched when only one changed', () => {
    const theirs = BASE.replace('Third paragraph.', 'Third, theirs.')

    expect(mergeText(BASE, BASE, theirs, 'mine')).toEqual({ text: theirs, conflicts: 0 })
    expect(mergeText(BASE, theirs, BASE, 'theirs')).toEqual({ text: theirs, conflicts: 0 })
  })
})
