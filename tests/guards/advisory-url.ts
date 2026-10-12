import type { TextFile, Violation } from './types.ts'

/**
 * Guard `advisory-url`: every place that sends a reporter to GitHub's private vulnerability
 * reporting sends them to the same address. `SECURITY.md`, the issue chooser
 * (`.github/ISSUE_TEMPLATE/config.yml`) and the bug form (`bug_report.yml`) each hold the
 * address of the project, and no other advisory address appears in them.
 */

export interface AdvisoryUrlInput {
  /** The three files, with their text. */
  files: readonly TextFile[]
  /** The address every one of them must hold. */
  expected: string
}

const ADVISORY = /https:\/\/github\.com\/[\w.-]+\/[\w.-]+\/security\/advisories\/new/g

export function checkAdvisoryUrl(input: AdvisoryUrlInput): Violation[] {
  const violations: Violation[] = []
  for (const file of input.files) {
    const found = new Set(file.text.match(ADVISORY) ?? [])
    if (!found.has(input.expected)) {
      violations.push({
        rule: 'advisory-url/missing',
        file: file.path,
        message: `the file must send reporters to ${input.expected}`,
      })
    }
    for (const url of found) {
      if (url !== input.expected) {
        violations.push({
          rule: 'advisory-url/different',
          file: file.path,
          message: `${url} is not the project's advisory address ${input.expected}`,
        })
      }
    }
  }
  return violations
}
