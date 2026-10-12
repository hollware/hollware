import type { TextFile, Violation } from './types.ts'

/**
 * Guard `agents-size`: an `AGENTS.md` stays short enough to be read whole. An agent loads the
 * file into its context on every task, so a file that grows past the limit costs every task;
 * move detail into a test, a lint rule or a nested `AGENTS.md` next to the code it governs.
 */

export const MAX_AGENTS_CHARACTERS = 12_000

export interface AgentsSizeInput {
  /** Every `AGENTS.md` of the repository, root and nested. */
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
