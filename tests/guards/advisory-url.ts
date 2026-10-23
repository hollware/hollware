import type { TextFile, Violation } from './types.ts'

export interface AdvisoryUrlInput {
  files: readonly TextFile[]
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
