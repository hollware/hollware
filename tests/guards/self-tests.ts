import { parseSync, Visitor } from 'vite-plus'
import { analyzeSource } from '../support/source.ts'
import type { TextFile, Violation } from './types.ts'

/**
 * Guard `self-tests`: no guard lands without proof that it can fail. Every module of
 * `tests/guards/` that exports a `check...` function is imported by a test of
 * `tests/conventions/` or `tests/meta/`, and that test has a `describe('self-test: ...')` block,
 * where the guard runs on a bad fixture and the exact violation is asserted. A guard that
 * only ever ran on the real repository, which passes, could be a function that returns `[]`.
 */

export interface SelfTestsInput {
  /** The modules of `tests/guards/`, with their text. */
  guards: readonly TextFile[]
  /** The tests of `tests/conventions/` and `tests/meta/`, with their text. */
  tests: readonly TextFile[]
}

const GUARD_FUNCTION = /^export function check\w+\(/m

/** Whether the file calls `describe('self-test: ...', ...)`. A comment or a string does not count. */
export function hasSelfTestBlock(file: TextFile): boolean {
  let found = false
  new Visitor({
    CallExpression(node) {
      const [title] = node.arguments
      if (
        node.callee.type === 'Identifier' &&
        node.callee.name === 'describe' &&
        title?.type === 'Literal' &&
        typeof title.value === 'string' &&
        title.value.startsWith('self-test')
      ) {
        found = true
      }
    },
  }).visit(parseSync(file.path, file.text).program)
  return found
}

export function checkSelfTests(input: SelfTestsInput): Violation[] {
  const violations: Violation[] = []
  const imports = input.tests.map((test) => ({
    test,
    modules: analyzeSource(test.path, test.text).references.map((reference) => reference.specifier),
  }))
  for (const guard of input.guards) {
    if (!GUARD_FUNCTION.test(guard.text)) continue
    const name = guard.path.slice(guard.path.lastIndexOf('/') + 1)
    const importing = imports.filter(({ modules }) => modules.includes(`../guards/${name}`))
    if (importing.length === 0) {
      violations.push({
        rule: 'self-tests/untested',
        file: guard.path,
        message: `no test of tests/conventions/ or tests/meta/ imports ${name}: a guard runs in a test, on the repository and on a bad fixture`,
      })
    } else if (!importing.some(({ test }) => hasSelfTestBlock(test))) {
      violations.push({
        rule: 'self-tests/no-self-test',
        file: guard.path,
        message: `${importing.map(({ test }) => test.path).join(', ')} runs ${name} but has no describe('self-test: ...') block that feeds it a bad fixture and asserts the exact violation`,
      })
    }
  }
  return violations
}
