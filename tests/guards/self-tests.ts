import type { ESTree } from 'vite-plus'
import { parseSync, Visitor } from 'vite-plus'
import { exportedNames, importBindings, indexCalls, type ImportBinding } from '../support/ast.ts'
import { lineAt } from '../support/source.ts'
import type { TextFile, Violation } from './types.ts'

/**
 * Guard `self-tests`: no guard lands without proof that it can fail. Every `check...` that a
 * module of `tests/guards/` exports (`export function`, `export async function`,
 * `export const check... =`, `export { check... }`) is imported by a test of `tests/conventions/`
 * or `tests/meta/`, and that test has a `describe('self-test: ...')` block whose callback calls
 * the check, directly or through a function the test file defines, and asserts with `expect(`.
 * A guard that only ever ran on the real repository, which passes, could be a function that
 * returns `[]`, and a block that never calls it proves nothing.
 *
 * It is a rule per exported check and not per module: a module that exports two checks needs a
 * self-test for each. The test file is followed through its own import: a rename
 * (`import { checkNew as run }`), a namespace (`guard.checkNew`) and a wrapper that the file
 * defines (`const check = (x) => checkNew(x)`) all count, and a call made in another file does
 * not.
 */

export interface SelfTestsInput {
  /** The modules of `tests/guards/`, with their text. */
  guards: readonly TextFile[]
  /** The tests of `tests/conventions/` and `tests/meta/`, with their text. */
  tests: readonly TextFile[]
}

/** What a `describe('self-test: ...', callback)` block of a test file does. */
export interface SelfTestBlock {
  title: string
  line: number
  /**
   * The names the callback calls, directly or through the functions the file defines: `check`
   * for `check(x)`, `guard.check` for `guard.check(x)`.
   */
  calls: ReadonlySet<string>
  /** Whether the callback itself calls `expect(...)`. */
  asserts: boolean
}

const SELF_TEST_TITLE = /^self-test/

/** The string a `describe` title is, when it is a plain string or a template without holes. */
function titleOf(node: ESTree.Argument | undefined): string | undefined {
  if (node?.type === 'Literal' && typeof node.value === 'string') return node.value
  if (node?.type === 'TemplateLiteral' && node.expressions.length === 0) {
    return node.quasis[0]?.value.cooked ?? undefined
  }
  return undefined
}

/**
 * The blocks a test file opens with `describe('self-test...', callback)`. Only the plain call
 * counts: a comment, a string, `it('self-test...')`, `describe.skip(...)` and `describe.each` do
 * not, because none of them runs the callback as a describe block.
 */
export function selfTestBlocks(file: TextFile): SelfTestBlock[] {
  const index = indexCalls(file.path, file.text)
  const blocks: SelfTestBlock[] = []
  new Visitor({
    CallExpression(node) {
      if (node.callee.type !== 'Identifier' || node.callee.name !== 'describe') return
      const title = titleOf(node.arguments[0])
      if (title === undefined || !SELF_TEST_TITLE.test(title)) return
      const callback = node.arguments.find(
        (argument) =>
          argument.type === 'ArrowFunctionExpression' || argument.type === 'FunctionExpression',
      )
      // A block without a callback has nothing in it: an empty range.
      const start = callback?.start ?? node.end
      const end = callback?.end ?? node.end
      blocks.push({
        title,
        line: lineAt(file.text, node.start),
        calls: index.reachableCalls(start, end),
        asserts: index.directCalls(start, end).has('expect'),
      })
    },
  }).visit(parseSync(file.path, file.text).program)
  return blocks
}

/** The names under which a test file can call `check` of the module imported as `specifier`. */
function callNames(bindings: readonly ImportBinding[], specifier: string, check: string): string[] {
  return bindings
    .filter((binding) => binding.specifier === specifier)
    .flatMap((binding) => {
      if (binding.imported === check) return [binding.local]
      return binding.imported === '*' ? [`${binding.local}.${check}`] : []
    })
}

export function checkSelfTests(input: SelfTestsInput): Violation[] {
  const violations: Violation[] = []
  const tests = input.tests.map((test) => ({
    path: test.path,
    bindings: importBindings(test.path, test.text),
    blocks: selfTestBlocks(test),
  }))
  for (const guard of input.guards) {
    const module = guard.path.slice(guard.path.lastIndexOf('/') + 1)
    const specifier = `../guards/${module}`
    const checks = exportedNames(guard.path, guard.text).filter((name) => name.startsWith('check'))
    for (const check of new Set(checks)) {
      const importing = tests
        .map((test) => ({ test, names: callNames(test.bindings, specifier, check) }))
        .filter(({ names }) => names.length > 0)
      if (importing.length === 0) {
        violations.push({
          rule: 'self-tests/untested',
          file: guard.path,
          message: `${check} is not imported by any test of tests/conventions/ or tests/meta/: a guard runs in a test, on the repository and on a bad fixture`,
        })
        continue
      }
      const callers = importing.flatMap(({ test, names }) =>
        test.blocks
          .filter((block) => names.some((name) => block.calls.has(name)))
          .map((block) => ({ path: test.path, block })),
      )
      if (callers.length === 0) {
        violations.push({
          rule: 'self-tests/no-self-test',
          file: guard.path,
          message: `${importing.map(({ test }) => test.path).join(', ')} imports ${check} but has no describe('self-test: ...') block that calls it, directly or through a function of the test file: feed it a bad fixture there and assert the exact violation`,
        })
      } else if (!callers.some(({ block }) => block.asserts)) {
        violations.push({
          rule: 'self-tests/no-assertion',
          file: guard.path,
          message: `${callers.map(({ path, block }) => `${path}:${block.line}`).join(', ')} calls ${check} in a describe('self-test: ...') block that never calls expect(): assert the exact violation there`,
        })
      }
    }
  }
  return violations
}
