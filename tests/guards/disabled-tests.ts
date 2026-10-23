import type { ESTree } from 'vite-plus'
import { parseSync, Visitor } from 'vite-plus'
import { importBindings } from '../support/ast.ts'
import { lineAt } from '../support/source.ts'
import { isTestFile } from './test-projects.ts'
import type { TextFile, Violation } from './types.ts'

export interface DisabledTestsInput {
  tests: readonly TextFile[]
}

export interface TestFileSelection {
  files: readonly string[]
  listed: readonly string[]
  runnerDirectories: readonly string[]
}

const SOURCE_FILE = /\.[cm]?[jt]sx?$/

export function testFilesToCheck(selection: TestFileSelection): string[] {
  const listed = new Set(selection.listed)
  return selection.files.filter(
    (path) =>
      listed.has(path) ||
      isTestFile(path) ||
      (SOURCE_FILE.test(path) &&
        selection.runnerDirectories.some((directory) => path.startsWith(directory))),
  )
}

const TEST_FUNCTIONS: ReadonlySet<string> = new Set(['it', 'test', 'describe', 'suite', 'bench'])

const DISABLING_MEMBERS: ReadonlySet<string> = new Set(['skip', 'todo', 'only', 'skipIf', 'runIf'])

const X_PREFIXED_FUNCTIONS: ReadonlySet<string> = new Set(['xit', 'xtest', 'xdescribe'])

function chainRoot(node: ESTree.Expression): ESTree.IdentifierReference | undefined {
  switch (node.type) {
    case 'Identifier':
      return node
    case 'MemberExpression':
      return chainRoot(node.object)
    case 'CallExpression':
      return chainRoot(node.callee)
    case 'ChainExpression':
    case 'ParenthesizedExpression':
    case 'TSNonNullExpression':
    case 'TSAsExpression':
    case 'TSSatisfiesExpression':
      return chainRoot(node.expression)
    default:
      return undefined
  }
}

function memberName(node: ESTree.MemberExpression): string | undefined {
  if (!node.computed) return node.property.type === 'Identifier' ? node.property.name : undefined
  const { property } = node
  return property.type === 'Literal' && typeof property.value === 'string'
    ? property.value
    : undefined
}

export function checkDisabledTests(input: DisabledTestsInput): Violation[] {
  const violations: Violation[] = []
  for (const test of input.tests) {
    const parsed = parseSync(test.path, test.text)
    for (const error of parsed.errors) {
      violations.push({
        rule: 'disabled-tests/syntax-error',
        file: test.path,
        message: `the file does not parse (${error.message}), so nobody can tell whether it disables a test`,
      })
    }
    const testFunctions = new Set(TEST_FUNCTIONS)
    for (const binding of importBindings(test.path, test.text)) {
      if (TEST_FUNCTIONS.has(binding.imported)) testFunctions.add(binding.local)
    }
    const derived: { name: string; from: ESTree.Expression }[] = []
    new Visitor({
      VariableDeclarator(node) {
        if (node.id.type === 'Identifier' && node.init !== null) {
          derived.push({ name: node.id.name, from: node.init })
        }
      },
    }).visit(parsed.program)
    for (let grew = true; grew;) {
      grew = false
      for (const { name, from } of derived) {
        const root = chainRoot(from)
        if (!testFunctions.has(name) && root !== undefined && testFunctions.has(root.name)) {
          testFunctions.add(name)
          grew = true
        }
      }
    }
    const reported = new Set<number>()
    const report = (at: number, form: string, member: string): void => {
      if (reported.has(at)) return
      reported.add(at)
      const line = lineAt(test.text, at)
      if (member === 'only') {
        violations.push({
          rule: 'disabled-tests/focused',
          file: test.path,
          message: `line ${line} has ${form}: a focused test makes the runner skip every other test of its file, so a green run proves less than it says: remove .only`,
        })
      } else {
        violations.push({
          rule: 'disabled-tests/disabled',
          file: test.path,
          message: `line ${line} has ${form}: a test that is skipped, left as a todo or run only sometimes proves nothing: delete it, or make it run`,
        })
      }
    }
    new Visitor({
      MemberExpression(node) {
        const member = memberName(node)
        const root = chainRoot(node.object)
        if (member === undefined || root === undefined) return
        if (DISABLING_MEMBERS.has(member) && testFunctions.has(root.name)) {
          report(node.property.start, `${root.name}.${member}`, member)
        }
      },
      CallExpression(node) {
        const root = chainRoot(node.callee)
        if (root !== undefined && X_PREFIXED_FUNCTIONS.has(root.name)) {
          report(root.start, root.name, 'skip')
        }
      },
    }).visit(parsed.program)
  }
  return violations
}
