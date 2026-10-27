import { ISSUES_URL } from './project.ts'
import type { TextFile, Violation } from './types.ts'

export interface CodeOfConductInput {
  conduct: TextFile
}

const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g

export function checkCodeOfConduct(input: CodeOfConductInput): Violation[] {
  const violations: Violation[] = []
  const { path, text } = input.conduct
  if (/\[INSERT/i.test(text)) {
    violations.push({
      rule: 'code-of-conduct/placeholder',
      file: path,
      message:
        'the file still holds a "[INSERT ...]" placeholder of the Contributor Covenant template',
    })
  }
  if (!text.includes(ISSUES_URL)) {
    violations.push({
      rule: 'code-of-conduct/contact',
      file: path,
      message: `the enforcement contact must be the issues of the repository, ${ISSUES_URL}`,
    })
  }
  for (const email of new Set(text.match(EMAIL) ?? [])) {
    violations.push({
      rule: 'code-of-conduct/contact',
      file: path,
      message: `${email} is an email address: reports go to ${ISSUES_URL}, and the file holds no address`,
    })
  }
  return violations
}
