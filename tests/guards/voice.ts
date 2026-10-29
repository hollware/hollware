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

const PRICES = [
  /\$\d/,
  /\b(for|is|it's) free\b/i,
  /\bfree to start\b/i,
  /\bzero cost\b/i,
  /\bgratis\b/i,
  /\bsin pagar\b/i,
]

const PUBLIC_COPY =
  /^(README\.md|packages\/[^/]+\/README\.md|templates\/[^/]+\/README\.md|apps\/web\/app\/i18n\/[^/]+\.ts)$/

export function checkVoice(files: readonly TextFile[]): Violation[] {
  const violations: Violation[] = []
  for (const file of files) {
    const lines = file.text.split('\n')
    const prices = PUBLIC_COPY.test(file.path)
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
      if (!prices) return
      for (const price of PRICES) {
        const found = price.exec(line)
        if (found === null) continue
        violations.push({
          rule: 'voice/price',
          file: file.path,
          message: `line ${index + 1} says "${found[0]}": what Hollware costs depends on what each site uses, so it promises no price (apps/web/AGENTS.md)`,
        })
      }
    })
  }
  return violations
}
