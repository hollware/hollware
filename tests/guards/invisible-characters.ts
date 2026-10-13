import type { TextFile, Violation } from './types.ts'

/**
 * Guard `invisible-characters`: no text file of the repository holds a character that changes how
 * text reads without being seen. That is the Unicode categories Cf, Zl and Zp: the bidirectional
 * controls that make a line display in another order than it runs (Trojan Source,
 * CVE-2021-42574), zero-width marks, a byte order mark, and the line and paragraph separators.
 * Code writes such a character as an escape or with `String.fromCodePoint`. A file that holds one
 * on purpose is listed, with its reason, in `tests/guards/exceptions.ts`, and arrives here as
 * `allowed`.
 */

const INVISIBLE = /[\p{Cf}\p{Zl}\p{Zp}]/u

export interface InvisibleCharactersInput {
  files: readonly TextFile[]
  /** The files that hold such a character on purpose. */
  allowed: readonly string[]
}

/** The first invisible character of a text: its line, from 1, and its code point as `U+XXXX`. */
function firstInvisible(text: string): { line: number; codePoint: string } | undefined {
  let line = 1
  for (const character of text) {
    if (INVISIBLE.test(character)) {
      const hex = (character.codePointAt(0) ?? 0).toString(16).toUpperCase().padStart(4, '0')
      return { line, codePoint: `U+${hex}` }
    }
    if (character === '\n') line += 1
  }
  return undefined
}

export function checkInvisibleCharacters(input: InvisibleCharactersInput): Violation[] {
  const violations: Violation[] = []
  const holding = new Set<string>()
  for (const file of input.files) {
    const found = firstInvisible(file.text)
    if (found === undefined) continue
    holding.add(file.path)
    if (input.allowed.includes(file.path)) continue
    violations.push({
      rule: 'invisible-characters/found',
      file: file.path,
      message: `line ${found.line} holds the invisible character ${found.codePoint}: remove it, or write it as an escape or with String.fromCodePoint`,
    })
  }
  for (const path of input.allowed) {
    if (!holding.has(path)) {
      violations.push({
        rule: 'invisible-characters/stale-exception',
        file: 'tests/guards/exceptions.ts',
        message: `${path} holds no invisible character any more: remove it from INVISIBLE_CHARACTER_FILES and lower its max`,
      })
    }
  }
  return violations
}
