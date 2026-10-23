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
