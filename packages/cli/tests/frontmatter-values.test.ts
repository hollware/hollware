import { describe, expect, it } from 'vite-plus/test'

import { withFrontmatterValues } from '../src/import/frontmatter-values.ts'

describe('withFrontmatterValues', () => {
  it('leaves a file byte for byte when every value is the one written', () => {
    const empty = '---\n---\n\nBody.\n'
    const crlf = '---\r\ntitle: A\r\ndate: 2026-10-01\r\n---\r\n'

    expect(withFrontmatterValues(empty, { draft: false }, { draft: false })).toBe(empty)
    expect(withFrontmatterValues(crlf, { title: 'A' }, { title: 'A' })).toBe(crlf)
  })

  it('rewrites only the line of a value that changed, and a list whole', () => {
    const markdown = '---\ntitle: A\ntags:\n  - one\n  - two\nlayout: post\n---\nBody.\n'

    expect(withFrontmatterValues(markdown, { tags: 'none', readingTime: 3 }, {})).toBe(
      '---\ntitle: A\ntags: "none"\nlayout: post\nreadingTime: 3\n---\nBody.\n',
    )
  })
})
