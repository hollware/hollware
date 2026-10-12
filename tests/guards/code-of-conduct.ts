import { CONDUCT_EMAIL } from './project.ts'
import type { TextFile, Violation } from './types.ts'

/**
 * Guard `code-of-conduct`: the Code of Conduct is finished. It keeps no template placeholder
 * (`[INSERT CONTACT METHOD]` of the Contributor Covenant), and the only address it holds is
 * the one reports go to, `conduct@hollware.com`.
 */

export interface CodeOfConductInput {
  /** `CODE_OF_CONDUCT.md`. */
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
  const emails = new Set(text.match(EMAIL) ?? [])
  if (!emails.has(CONDUCT_EMAIL)) {
    violations.push({
      rule: 'code-of-conduct/contact',
      file: path,
      message: `the enforcement contact must be ${CONDUCT_EMAIL}`,
    })
  }
  for (const email of emails) {
    if (email !== CONDUCT_EMAIL) {
      violations.push({
        rule: 'code-of-conduct/contact',
        file: path,
        message: `${email} is not the enforcement contact ${CONDUCT_EMAIL}: it is the only address the file may hold`,
      })
    }
  }
  return violations
}
