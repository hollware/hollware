import { parseJson, type JsonResult } from './values.ts'

/**
 * Turns JSONC (JSON with `//` and block comments and trailing commas, the format of
 * `wrangler.jsonc`) into plain JSON. Comments become spaces, so offsets and line numbers
 * stay put. String contents are never touched, so a URL such as "https://example.com" keeps
 * its `//`. The text is not validated: `JSON.parse` does that afterwards.
 */
export function stripJsonc(text: string): string {
  const out: string[] = []
  // Index in `out` of a comma that only whitespace and comments have followed so far.
  let pendingComma = -1
  let i = 0
  while (i < text.length) {
    const char = text.charAt(i)
    const next = text.charAt(i + 1)
    if (char === '"') {
      pendingComma = -1
      out.push(char)
      i += 1
      while (i < text.length) {
        const inString = text.charAt(i)
        out.push(inString)
        i += 1
        if (inString === '\\') {
          out.push(text.charAt(i))
          i += 1
        } else if (inString === '"') {
          break
        }
      }
    } else if (char === '/' && next === '/') {
      while (i < text.length && text.charAt(i) !== '\n') {
        out.push(' ')
        i += 1
      }
    } else if (char === '/' && next === '*') {
      const end = text.indexOf('*/', i + 2)
      const stop = end === -1 ? text.length : end + 2
      for (; i < stop; i += 1) out.push(text.charAt(i) === '\n' ? '\n' : ' ')
    } else {
      if (char === ',') {
        pendingComma = out.length
      } else if (char === '}' || char === ']') {
        if (pendingComma !== -1) out[pendingComma] = ' '
        pendingComma = -1
      } else if (!/\s/.test(char)) {
        pendingComma = -1
      }
      out.push(char)
      i += 1
    }
  }
  return out.join('')
}

/** Parses JSONC. A syntax error is reported in the result, never thrown. */
export function parseJsonc(text: string): JsonResult {
  return parseJson(stripJsonc(text))
}
