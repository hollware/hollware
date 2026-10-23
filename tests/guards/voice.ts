import type { TextFile, Violation } from './types.ts'

const NEVER = [
  /\bAI-[p]owered\b/i,
  /\bauto[p]ilot\b/i,
  /\bseam[l]ess(ly)?\b/i,
  /\bun[l]eash(es|ed|ing)?\b/i,
  /\bnext-[g]en\b/i,
  /\bb[l]azing(ly)? fast\b/i,
  /\bspo[o]ky\b/i,
]

export function checkVoice(files: readonly TextFile[]): Violation[] {
  const violations: Violation[] = []
  for (const file of files) {
    const lines = file.text.split('\n')
    lines.forEach((line, index) => {
      for (const word of NEVER) {
        const found = word.exec(line)
        if (found === null) continue
        violations.push({
          rule: 'voice/never',
          file: file.path,
          message: `line ${index + 1} says "${found[0]}": say what happens instead (apps/web/AGENTS.md)`,
        })
      }
    })
  }
  return violations
}
