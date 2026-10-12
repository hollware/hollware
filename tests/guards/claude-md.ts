import type { Violation } from './types.ts'

/**
 * Guard `no-claude-md`: there is no `CLAUDE.md` and there must never be one. Agents read
 * `AGENTS.md`. The guard looks at every file of the repository and at the whole working
 * tree outside `node_modules`, so an untracked or ignored copy is found too. The name is
 * compared without regard to case, because the usual file systems of developers are
 * case-insensitive.
 */

export interface ClaudeMdInput {
  /** Repository files and working-tree files, repository-relative. Duplicates are fine. */
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
