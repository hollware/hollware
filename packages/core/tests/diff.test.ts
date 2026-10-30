import { describe, expect, it } from 'vite-plus/test'

import { unifiedDiff } from '../src/diff.ts'

const TEN = ['one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten']

function text(lines: readonly string[]): string {
  return `${lines.join('\n')}\n`
}

describe('unifiedDiff', () => {
  it('is empty for two equal texts', () => {
    expect(unifiedDiff(text(TEN), text(TEN))).toBe('')
    expect(unifiedDiff('', '')).toBe('')
  })

  it('shows a changed line with three lines of context on each side', () => {
    const after = text(TEN.map((line) => (line === 'five' ? 'FIVE' : line)))

    expect(unifiedDiff(text(TEN), after)).toBe(
      '@@ -2,7 +2,7 @@\n two\n three\n four\n-five\n+FIVE\n six\n seven\n eight\n',
    )
  })

  it('keeps two changes far apart in two hunks, and close ones in one', () => {
    const far = text(
      TEN.map((line) => (line === 'one' || line === 'ten' ? line.toUpperCase() : line)),
    )
    const close = text(
      TEN.map((line) => (line === 'two' || line === 'eight' ? line.toUpperCase() : line)),
    )

    expect(unifiedDiff(text(TEN), far)).toBe(
      '@@ -1,4 +1,4 @@\n-one\n+ONE\n two\n three\n four\n@@ -7,4 +7,4 @@\n seven\n eight\n nine\n-ten\n+TEN\n',
    )
    expect(unifiedDiff(text(TEN), close)).toBe(
      '@@ -1,10 +1,10 @@\n one\n-two\n+TWO\n three\n four\n five\n six\n seven\n-eight\n+EIGHT\n nine\n ten\n',
    )
  })

  it('counts added and removed lines in the ranges of the hunk', () => {
    expect(unifiedDiff('a\nb\nc\n', 'a\nb\nx\ny\nc\n')).toBe(
      '@@ -1,3 +1,5 @@\n a\n b\n+x\n+y\n c\n',
    )
    expect(unifiedDiff('a\nb\nc\n', 'a\nc\n')).toBe('@@ -1,3 +1,2 @@\n a\n-b\n c\n')
  })

  it('diffs a new text against nothing, and nothing against an old one', () => {
    expect(unifiedDiff('', '# Title\n\nBody\n')).toBe('@@ -0,0 +1,3 @@\n+# Title\n+\n+Body\n')
    expect(unifiedDiff('only\n', '')).toBe('@@ -1 +0,0 @@\n-only\n')
  })

  it('finds the lines two texts share inside a changed block', () => {
    expect(unifiedDiff('a\nb\nc\nd\n', 'x\nb\ny\nd\n')).toBe(
      '@@ -1,4 +1,4 @@\n-a\n+x\n b\n-c\n+y\n d\n',
    )
  })
})
