import type { TextFile, Violation } from './types.ts'

export interface LegacyRoleInput {
  sources: readonly TextFile[]
}

const READS = [/\busers\.role\b/, /\bFROM users WHERE role\b/i, /\bu\.role\b/]

export function checkLegacyRole(input: LegacyRoleInput): Violation[] {
  const violations: Violation[] = []
  for (const file of input.sources) {
    const lines = file.text.split('\n')
    lines.forEach((line, index) => {
      if (/^\s*(\/\/|\/\*|\*)/.test(line)) return
      if (READS.some((pattern) => pattern.test(line))) {
        violations.push({
          rule: 'legacy-role/read',
          file: file.path,
          message: `line ${index + 1} reads users.role: read the role of a person in a site from members`,
        })
      }
    })
  }
  return violations
}
