import type { TextFile, Violation } from './types.ts'

const INVISIBLE = /[\p{Cf}\p{Zl}\p{Zp}]/u

export interface InvisibleCharactersInput {
  files: readonly TextFile[]
  allowed: readonly string[]
}

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
