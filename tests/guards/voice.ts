import type { TextFile, Violation } from './types.ts'

const NEVER_WORDS = [
  'AI-[p]owered',
  'auto[p]ilot',
  'seam[l]ess',
  'seam[l]essly',
  'un[l]eash',
  'un[l]eashes',
  'un[l]eashed',
  'un[l]eashing',
  'next-[g]en',
  'b[l]azing fast',
  'b[l]azingly fast',
  'spo[o]ky',
]

const PRICE_WORDS = [
  'is [f]ree',
  'for [f]ree',
  "it's [f]ree",
  '[f]ree to start',
  'zero [c]ost',
  'gr[a]tis',
  'sin [p]agar',
]

const asWord = (word: string) => new RegExp(`\\b${word}\\b`, 'i')

const NEVER = NEVER_WORDS.map(asWord)

const PRICES = [/\$\d/, ...PRICE_WORDS.map(asWord)]

export const VOICE_WORDS: readonly string[] = [...NEVER_WORDS, ...PRICE_WORDS].map((word) =>
  word.replace(/[[\]]/g, ''),
)

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
