/** One claim of the repository that stopped being true, found by a guard. */
export interface Violation {
  /** Stable id of the broken rule: `<guard>/<rule>`. */
  rule: string
  /** Repository-relative path of the file that breaks the rule. */
  file: string
  /** What is wrong and how to fix it. */
  message: string
}

/** One readable line per violation, so a failing test prints what to fix. */
export function describeViolations(violations: readonly Violation[]): string[] {
  return violations.map(
    (violation) => `${violation.file}: [${violation.rule}] ${violation.message}`,
  )
}

/** A file handed to a guard: its repository-relative path and its text. */
export interface TextFile {
  path: string
  text: string
}
