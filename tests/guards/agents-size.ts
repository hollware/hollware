import type { TextFile, Violation } from './types.ts'

export const MAX_AGENTS_CHARACTERS = 12_000

export interface AgentsSizeInput {
  docs: readonly TextFile[]
  max: number
}

export function checkAgentsSize(input: AgentsSizeInput): Violation[] {
  const violations: Violation[] = []
  for (const doc of input.docs) {
    const length = Array.from(doc.text).length
    if (length > input.max) {
      violations.push({
        rule: 'agents-size/too-long',
        file: doc.path,
        message: `the file has ${length} characters, ${length - input.max} over the limit of ${input.max}: move detail into a test, a lint rule or a nested AGENTS.md`,
      })
    }
  }
  return violations
}
