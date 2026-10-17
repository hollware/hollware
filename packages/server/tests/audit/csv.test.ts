import { describe, expect, it } from 'vite-plus/test'

import { csvField } from '../../src/audit/read.ts'

// Fails when: csvField (src/audit/read.ts) stops leading with an apostrophe a cell that a
// spreadsheet would run as a formula (=, +, -, @, a tab, a return), or stops quoting a cell with a
// comma, a quote or a line break as RFC 4180 does, or writes null as anything but an empty cell.

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
