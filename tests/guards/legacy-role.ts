import type { TextFile, Violation } from './types.ts'

/**
 * Guard `legacy-role`: roles live in `members` since v0.3 (ADR-026). `users.role` stays only
 * because SQLite changes a CHECK by rebuilding the table, which D1 refuses once other rows point at
 * `users` (packages/server/src/db/schema.ts). So no source of a package reads it: a read would see
 * the names of v0.2, where an author is a `reviewer`.
 */

export interface LegacyRoleInput {
  /** The source files of the packages, with their text. */
  sources: readonly TextFile[]
}

/** A read of `users.role`, as drizzle or as SQL writes it. */
const READS = [/\busers\.role\b/, /\bFROM users WHERE role\b/i, /\bu\.role\b/]

export function checkLegacyRole(input: LegacyRoleInput): Violation[] {
  const violations: Violation[] = []
  for (const file of input.sources) {
    const lines = file.text.split('\n')
    lines.forEach((line, index) => {
      // A comment may name the column, as this one does: only code reads it.
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
