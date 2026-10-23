import type { TextFile, Violation } from './types.ts'

export interface PersonalEmailInput {
  files: readonly TextFile[]
}

const AT = '@'

const PATTERNS: readonly { rule: string; pattern: RegExp; what: string }[] = [
  {
    rule: 'handle',
    pattern: new RegExp(`sergioazoc${AT}(?!users\\.noreply\\.github\\.com)[\\w-]+(?:\\.[\\w-]+)+`),
    what: "an address at the maintainer's handle",
  },
  {
    rule: 'gmail',
    pattern: new RegExp(`[\\w.+-]*${AT}gmail\\.com`, 'i'),
    what: 'a gmail.com address',
  },
]

export function checkPersonalEmail(input: PersonalEmailInput): Violation[] {
  const violations: Violation[] = []
  for (const file of input.files) {
    for (const [index, line] of file.text.split('\n').entries()) {
      for (const { rule, pattern, what } of PATTERNS) {
        if (pattern.test(line)) {
          violations.push({
            rule: `personal-email/${rule}`,
            file: file.path,
            message: `line ${index + 1} holds ${what}: use the GitHub no-reply address or a project address`,
          })
        }
      }
    }
  }
  return violations
}
