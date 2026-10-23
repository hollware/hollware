import type { Violation } from './types.ts'

export interface ClaudeMdInput {
  paths: readonly string[]
}

export function checkNoClaudeMd(input: ClaudeMdInput): Violation[] {
  const violations: Violation[] = []
  for (const path of [...new Set(input.paths)].sort()) {
    const name = path.slice(path.lastIndexOf('/') + 1)
    if (name.toLowerCase() === 'claude.md') {
      violations.push({
        rule: 'no-claude-md/present',
        file: path,
        message: 'there must be no CLAUDE.md: delete it and put the guidance in AGENTS.md',
      })
    }
  }
  return violations
}
