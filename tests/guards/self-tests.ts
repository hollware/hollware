import type { ESTree } from 'vite-plus'
import { parseSync, Visitor } from 'vite-plus'
import { exportedNames, importBindings, indexCalls, type ImportBinding } from '../support/ast.ts'
import { lineAt } from '../support/source.ts'
import type { TextFile, Violation } from './types.ts'

export interface SelfTestsInput {
  guards: readonly TextFile[]
  tests: readonly TextFile[]
}

export interface SelfTestBlock {
  title: string
  line: number
  calls: ReadonlySet<string>
  asserts: boolean
}

const SELF_TEST_TITLE = /^self-test/

function titleOf(node: ESTree.Argument | undefined): string | undefined {
  if (node?.type === 'Literal' && typeof node.value === 'string') return node.value
  if (node?.type === 'TemplateLiteral' && node.expressions.length === 0) {
    return node.quasis[0]?.value.cooked ?? undefined
  }
  return undefined
}

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
