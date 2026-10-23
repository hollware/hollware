export interface Violation {
  rule: string
  file: string
  message: string
}

export function describeViolations(violations: readonly Violation[]): string[] {
  return violations.map(
    (violation) => `${violation.file}: [${violation.rule}] ${violation.message}`,
  )
}

export interface TextFile {
  path: string
  text: string
}
