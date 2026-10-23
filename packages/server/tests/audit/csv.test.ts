import { describe, expect, it } from 'vite-plus/test'

import { csvField } from '../../src/audit/read.ts'

describe('a field of the CSV of the activity log', () => {
  it.each([
    ['plain text as it is', 'Ana', 'Ana'],
    ['nothing for null', null, ''],
    ['a formula led by an apostrophe', '=HYPERLINK("x")', `"'=HYPERLINK(""x"")"`],
    ['a plus led by an apostrophe', '+1', "'+1"],
    ['a minus led by an apostrophe', '-1', "'-1"],
    ['an at sign led by an apostrophe', '@SUM(A1)', "'@SUM(A1)"],
    ['a tab first led by an apostrophe', '\tx', "'\tx"],
    ['a comma quoted', 'a,b', '"a,b"'],
    ['a line break quoted', 'a\nb', '"a\nb"'],
  ])('writes %s', (_name, value, expected) => {
    expect(csvField(value)).toBe(expected)
  })
})
