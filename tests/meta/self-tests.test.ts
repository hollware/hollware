import { describe, expect, it } from 'vite-plus/test'
import { checkSelfTests, selfTestBlocks } from '../guards/self-tests.ts'
import { describeViolations, type TextFile } from '../guards/types.ts'
import { exportedNames } from '../support/ast.ts'
import { file } from '../support/fixtures.ts'
import { readRepoFiles } from '../support/repo.ts'

const guardModule = (...lines: string[]) => file('tests/guards/new.ts', lines.join('\n'))

const GUARD = guardModule('export function checkNew(input: string) { return [] }')

const testFile = (...lines: string[]) => file('tests/meta/new.test.ts', lines.join('\n'))

const IMPORT = "import { checkNew } from '../guards/new.ts'"

const PROVED = testFile(
  IMPORT,
  "it('holds', () => { expect(checkNew('real')).toEqual([]) })",
  "describe('self-test: the guard fails on a bad fixture', () => {",
  "  it('reports it', () => { expect(checkNew('bad')).toEqual([{ rule: 'new/bad' }]) })",
  '})',
)

const check = (guards: TextFile[], ...tests: TextFile[]) => checkSelfTests({ guards, tests })

const rules = (guards: TextFile[], ...tests: TextFile[]) =>
  check(guards, ...tests).map((violation) => `${violation.rule}`)

describe('guard self-tests', () => {
  it('every exported check is run by a test with a self-test block that calls it and asserts', () => {
    const guards = readRepoFiles((path) => /^tests\/guards\/[^/]+\.ts$/.test(path))
    const tests = readRepoFiles((path) =>
      /^tests\/(?:conventions|meta)\/[^/]+\.test\.ts$/.test(path),
    )
    const checks = guards.flatMap((guard) =>
      exportedNames(guard.path, guard.text).filter((name) => name.startsWith('check')),
    )
    expect(checks.length).toBeGreaterThan(30)
    expect(checks).toEqual(
      expect.arrayContaining(['checkExceptionLists', 'checkNoStrayExceptions', 'checkSelfTests']),
    )
    expect(tests.length).toBeGreaterThan(30)
    expect(describeViolations(checkSelfTests({ guards, tests }))).toEqual([])
  })

  describe('self-test: the guard fails on a bad fixture', () => {
    it('accepts a check whose test has a self-test that calls it and asserts, and ignores modules that are not guards', () => {
      const helper = file(
        'tests/guards/helper.ts',
        'export function parse(input: string) { return input }',
      )
      expect(check([GUARD, helper], PROVED)).toEqual([])
    })

    it('reports a plain check that no test imports', () => {
      expect(check([GUARD])).toEqual([
        {
          rule: 'self-tests/untested',
          file: 'tests/guards/new.ts',
          message:
            'checkNew is not imported by any test of tests/conventions/ or tests/meta/: a guard runs in a test, on the repository and on a bad fixture',
        },
      ])
    })

    it('reports an async check and a const check that no test imports', () => {
      const asyncGuard = guardModule('export async function checkNew(input: string) { return [] }')
      const constGuard = guardModule('export const checkNew = (input: string) => []')
      const functionGuard = guardModule(
        'export const checkNew = async function (input: string) { return [] }',
      )
      const listedGuard = guardModule('const checkNew = () => []', 'export { checkNew }')
      const renamedGuard = guardModule('const run = () => []', 'export { run as checkNew }')
      for (const guard of [asyncGuard, constGuard, functionGuard, listedGuard, renamedGuard]) {
        expect(check([guard])).toEqual([
          {
            rule: 'self-tests/untested',
            file: 'tests/guards/new.ts',
            message:
              'checkNew is not imported by any test of tests/conventions/ or tests/meta/: a guard runs in a test, on the repository and on a bad fixture',
          },
        ])
      }
    })

    it('does not take a type, a default export or a name that merely contains check for a guard', () => {
      const guard = guardModule(
        'export type checkType = string',
        'export interface checkShape { a: string }',
        'export default function checkDefault() { return [] }',
        'export function recheck() { return [] }',
        'function checkLocal() { return [] }',
      )
      expect(check([guard])).toEqual([])
    })

    it('reports a test that only runs the check on the repository', () => {
      const test = testFile(IMPORT, "it('holds', () => { expect(checkNew('real')).toEqual([]) })")
      expect(check([GUARD], test)).toEqual([
        {
          rule: 'self-tests/no-self-test',
          file: 'tests/guards/new.ts',
          message:
            "tests/meta/new.test.ts imports checkNew but has no describe('self-test: ...') block that calls it, directly or through a function of the test file: feed it a bad fixture there and assert the exact violation",
        },
      ])
    })

    it('reports an empty self-test block', () => {
      const test = testFile(
        IMPORT,
        "describe('self-test: the guard fails on a bad fixture', () => {})",
      )
      expect(rules([GUARD], test)).toEqual(['self-tests/no-self-test'])
      const noCallback = testFile(IMPORT, "describe('self-test: the guard fails on a bad fixture')")
      expect(rules([GUARD], noCallback)).toEqual(['self-tests/no-self-test'])
    })

    it('reports a self-test block that never calls the check', () => {
      const unrelated = testFile(
        IMPORT,
        "describe('self-test: the guard fails on a bad fixture', () => {",
        "  it('asserts something else', () => { expect(1 + 1).toBe(2) })",
        '})',
      )
      expect(rules([GUARD], unrelated)).toEqual(['self-tests/no-self-test'])
      const mentioned = testFile(
        IMPORT,
        "describe('self-test: the guard fails on a bad fixture', () => {",
        "  it('names it', () => { expect(typeof checkNew).toBe('function') })",
        '})',
      )
      expect(rules([GUARD], mentioned)).toEqual(['self-tests/no-self-test'])
    })

    it('reports a self-test block that calls the check and asserts nothing', () => {
      const test = testFile(
        IMPORT,
        "describe('self-test: the guard fails on a bad fixture', () => {",
        "  it('runs it', () => { checkNew('bad') })",
        '})',
      )
      expect(check([GUARD], test)).toEqual([
        {
          rule: 'self-tests/no-assertion',
          file: 'tests/guards/new.ts',
          message:
            "tests/meta/new.test.ts:2 calls checkNew in a describe('self-test: ...') block that never calls expect(): assert the exact violation there",
        },
      ])
    })

    it('does not count a self-test block that is not a describe call, or a call outside the block', () => {
      const text = (title: string, open: string) =>
        testFile(IMPORT, `${open}('${title}', () => { expect(checkNew('bad')).toEqual([1]) })`)
      expect(rules([GUARD], text('self-test: x', 'it'))).toEqual(['self-tests/no-self-test'])
      expect(rules([GUARD], text('self-test: x', 'describe.skip'))).toEqual([
        'self-tests/no-self-test',
      ])
      expect(rules([GUARD], text('the real repository', 'describe'))).toEqual([
        'self-tests/no-self-test',
      ])
      const outside = testFile(
        IMPORT,
        "expect(checkNew('bad')).toEqual([1])",
        "describe('self-test: x', () => { it('empty', () => {}) })",
      )
      expect(rules([GUARD], outside)).toEqual(['self-tests/no-self-test'])
    })

    it('does not take a self-test in a comment or a string for the real thing', () => {
      const test = testFile(
        IMPORT,
        "// describe('self-test: later', () => { expect(checkNew('x')).toEqual([]) })",
        'const note = "describe(\'self-test: x\', () => { expect(checkNew(1)) })"',
      )
      expect(rules([GUARD], test)).toEqual(['self-tests/no-self-test'])
    })

    it('follows a helper that the test file defines, at any depth, and finds an alias or a namespace', () => {
      const body = (...lines: string[]) => [
        "describe('self-test: the guard fails on a bad fixture', () => {",
        ...lines.map((line) => `  ${line}`),
        '})',
      ]
      const viaHelper = testFile(
        IMPORT,
        'const check = (text: string) => checkNew(text)',
        ...body("it('reports it', () => { expect(check('bad')).toEqual([1]) })"),
      )
      const viaTwoHelpers = testFile(
        IMPORT,
        'function inner(text: string) { return checkNew(text) }',
        'const outer = (text: string) => inner(text)',
        ...body("it('reports it', () => { expect(outer('bad')).toEqual([1]) })"),
      )
      const helperInsideTheBlock = testFile(
        IMPORT,
        ...body(
          'const check = (text: string) => checkNew(text)',
          "it('reports it', () => { expect(check('bad')).toEqual([1]) })",
        ),
      )
      const aliased = testFile(
        "import { checkNew as run } from '../guards/new.ts'",
        ...body("it('reports it', () => { expect(run('bad')).toEqual([1]) })"),
      )
      const namespaced = testFile(
        "import * as guard from '../guards/new.ts'",
        ...body("it('reports it', () => { expect(guard.checkNew('bad')).toEqual([1]) })"),
      )
      for (const test of [viaHelper, viaTwoHelpers, helperInsideTheBlock, aliased, namespaced]) {
        expect(check([GUARD], test)).toEqual([])
      }
    })

    it('does not follow a helper that never reaches the check', () => {
      const helperThatDoesNotCall = testFile(
        IMPORT,
        'const check = (text: string) => text.length',
        "it('holds', () => { expect(checkNew('real')).toEqual([]) })",
        "describe('self-test: the guard fails on a bad fixture', () => {",
        "  it('reports it', () => { expect(check('bad')).toBe(3) })",
        '})',
      )
      const helperLeftUnused = testFile(
        IMPORT,
        'const check = (text: string) => checkNew(text)',
        "describe('self-test: the guard fails on a bad fixture', () => {",
        "  it('asserts something else', () => { expect(1).toBe(1) })",
        '})',
      )
      expect(rules([GUARD], helperThatDoesNotCall)).toEqual(['self-tests/no-self-test'])
      expect(rules([GUARD], helperLeftUnused)).toEqual(['self-tests/no-self-test'])
    })

    it('needs the proof in a test that imports the check from that module', () => {
      const local = testFile(
        'const checkNew = (text: string) => [text]',
        "describe('self-test: the guard fails on a bad fixture', () => {",
        "  it('reports it', () => { expect(checkNew('bad')).toEqual([1]) })",
        '})',
      )
      const otherModule = testFile(
        "import { checkNew } from '../guards/other.ts'",
        "describe('self-test: the guard fails on a bad fixture', () => {",
        "  it('reports it', () => { expect(checkNew('bad')).toEqual([1]) })",
        '})',
      )
      const typeOnly = testFile(
        "import type { checkNew } from '../guards/new.ts'",
        "describe('self-test: the guard fails on a bad fixture', () => {",
        "  it('reports it', () => { expect(1).toBe(1) })",
        '})',
      )
      expect(rules([GUARD], local)).toEqual(['self-tests/untested'])
      expect(rules([GUARD], otherModule)).toEqual(['self-tests/untested'])
      expect(rules([GUARD], typeOnly)).toEqual(['self-tests/untested'])
    })

    it('asks for a self-test per exported check, not per module', () => {
      const two = guardModule(
        'export function checkOne() { return [] }',
        'export async function checkTwo() { return [] }',
      )
      const proof = (name: string) =>
        [
          "describe('self-test: the guard fails on a bad fixture', () => {",
          `  it('reports it', () => { expect(${name}('bad')).toEqual([1]) })`,
          '})',
        ].join('\n')
      const importsOne = testFile("import { checkOne } from '../guards/new.ts'", proof('checkOne'))
      expect(check([two], importsOne)).toEqual([
        {
          rule: 'self-tests/untested',
          file: 'tests/guards/new.ts',
          message:
            'checkTwo is not imported by any test of tests/conventions/ or tests/meta/: a guard runs in a test, on the repository and on a bad fixture',
        },
      ])
      const callsOne = testFile(
        "import { checkOne, checkTwo } from '../guards/new.ts'",
        "const real = [checkOne('a'), checkTwo('a')]",
        proof('checkOne'),
      )
      expect(check([two], callsOne)).toEqual([
        {
          rule: 'self-tests/no-self-test',
          file: 'tests/guards/new.ts',
          message:
            "tests/meta/new.test.ts imports checkTwo but has no describe('self-test: ...') block that calls it, directly or through a function of the test file: feed it a bad fixture there and assert the exact violation",
        },
      ])
      const importsTwo = file(
        'tests/meta/two.test.ts',
        ["import { checkTwo } from '../guards/new.ts'", proof('checkTwo')].join('\n'),
      )
      expect(check([two], importsOne, importsTwo)).toEqual([])
    })

    it('finds the self-test blocks of a test file, with their calls and their assertions', () => {
      const blocks = selfTestBlocks(
        testFile(
          "import { checkNew } from '../guards/new.ts'",
          'const check = (x: string) => checkNew(x)',
          "describe('real repository', () => { expect(checkNew('a')).toEqual([]) })",
          "describe('self-test: first', () => {",
          "  it('a', () => { expect(check('b')).toEqual([1]) })",
          '})',
          'describe(`self-test: second`, function () {',
          "  it('b', () => { check('c') })",
          '})',
          "describe('self-test: third')",
        ),
      )
      expect(
        blocks.map((block) => ({
          title: block.title,
          line: block.line,
          calls: [...block.calls].sort(),
          asserts: block.asserts,
        })),
      ).toEqual([
        {
          title: 'self-test: first',
          line: 4,
          calls: ['check', 'checkNew', 'expect', 'it'],
          asserts: true,
        },
        { title: 'self-test: second', line: 7, calls: ['check', 'checkNew', 'it'], asserts: false },
        { title: 'self-test: third', line: 10, calls: [], asserts: false },
      ])
    })
  })
})
