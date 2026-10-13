/**
 * Reads JSON with comments, the format of `wrangler.jsonc`: `//` and `/* *\/` comments and a
 * comma before a closing bracket are dropped, and a comment marker inside a string is left
 * alone. It does nothing else: whatever `JSON.parse` rejects after that is an error.
 */
export function parseJsonc(text: string): unknown {
  return JSON.parse(stripJsonc(text))
}

type Mode = 'code' | 'string' | 'line-comment' | 'block-comment'

function stripJsonc(text: string): string {
  const source = text.startsWith('\uFEFF') ? text.slice(1) : text
  let out = ''
  let mode: Mode = 'code'
  for (let i = 0; i < source.length; i += 1) {
    const char = source.charAt(i)
    const next = source.charAt(i + 1)
    if (mode === 'string') {
      out += char
      if (char === '\\') {
        out += next
        i += 1
      } else if (char === '"') {
        mode = 'code'
      }
    } else if (mode === 'line-comment') {
      if (char === '\n') {
        out += char
        mode = 'code'
      }
    } else if (mode === 'block-comment') {
      if (char === '*' && next === '/') {
        i += 1
        mode = 'code'
      } else if (char === '\n') {
        out += char
      }
    } else if (char === '"') {
      out += char
      mode = 'string'
    } else if (char === '/' && next === '/') {
      i += 1
      mode = 'line-comment'
    } else if (char === '/' && next === '*') {
      i += 1
      mode = 'block-comment'
    } else {
      out += char
    }
  }
  if (mode === 'block-comment') throw new SyntaxError('a /* comment is never closed')
  return dropTrailingCommas(out)
}

/** Drops a comma that only whitespace separates from a closing bracket, outside strings. */
function dropTrailingCommas(code: string): string {
  let out = ''
  let inString = false
  for (let i = 0; i < code.length; i += 1) {
    const char = code.charAt(i)
    if (inString) {
      out += char
      if (char === '\\') {
        out += code.charAt(i + 1)
        i += 1
      } else if (char === '"') {
        inString = false
      }
    } else if (char === '"') {
      out += char
      inString = true
    } else if (char === ',' && /^\s*[}\]]/.test(code.slice(i + 1))) {
      continue
    } else {
      out += char
    }
  }
  return out
}
