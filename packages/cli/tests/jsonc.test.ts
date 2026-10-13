// Fails when:
// - "reads the comments and the trailing commas of a wrangler.jsonc": `stripJsonc` stops
//   dropping `//` comments, `/* */` comments (also over several lines) or a comma before `}`
//   or `]`, or drops the byte order mark wrongly.
// - "leaves comment markers and commas inside strings alone": the string mode of `stripJsonc`
//   or of `dropTrailingCommas` is lost, so `"https://x.test"` or `"a, ]"` is changed.
// - "keeps an escaped quote inside a string": the escape handling of the string mode is lost,
//   so a `\"` ends the string early and the comment after it is kept (or the text after it
//   is taken for a comment).
// - "rejects a comment that never closes": the unterminated block comment is accepted.
// - "rejects what is not JSON after the comments are gone": the parser accepts a missing value
//   or a missing comma.
import { describe, expect, it } from 'vite-plus/test'

import { parseJsonc } from '../src/jsonc.ts'

describe('parseJsonc', () => {
  it('reads the comments and the trailing commas of a wrangler.jsonc', () => {
    const text = `\uFEFF{
  // a line comment
  "name": "app", // after a value
  /* a block
     comment */
  "list": [1, 2, 3,],
  "nested": { "a": true, },
}
`
    expect(parseJsonc(text)).toEqual({ name: 'app', list: [1, 2, 3], nested: { a: true } })
  })

  it('leaves comment markers and commas inside strings alone', () => {
    const text = `{
  "url": "https://example.test//path",
  "block": "a /* not a comment */ b",
  "closing": "a, ]",
  "also": "x,}"
}`
    expect(parseJsonc(text)).toEqual({
      url: 'https://example.test//path',
      block: 'a /* not a comment */ b',
      closing: 'a, ]',
      also: 'x,}',
    })
  })

  it('keeps an escaped quote inside a string', () => {
    const text = String.raw`{ "quote": "say \"hi\" // still the string", "next": 1 // gone
}`
    expect(parseJsonc(text)).toEqual({ quote: 'say "hi" // still the string', next: 1 })
  })

  it('rejects a comment that never closes', () => {
    expect(() => parseJsonc('{ "a": 1 /* never closed }')).toThrow('a /* comment is never closed')
  })

  it.each(['{ "a": }', '{ "a": 1 "b": 2 }', ''])('rejects what is not JSON: %j', (text) => {
    expect(() => parseJsonc(text)).toThrow(SyntaxError)
  })
})
