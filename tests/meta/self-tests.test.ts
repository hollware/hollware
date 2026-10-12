import { describe, expect, it } from 'vite-plus/test'
import { checkSelfTests, hasSelfTestBlock } from '../guards/self-tests.ts'
import { describeViolations } from '../guards/types.ts'
import { file } from '../support/fixtures.ts'
import { readRepoFiles } from '../support/repo.ts'

// Fails when: a module of tests/guards/ exports a `check...` function that no test of
// tests/conventions/ or tests/meta/ imports, or that its test never feeds a bad fixture (no
// `describe('self-test: ...')` block).

describe('guard self-tests', () => {
  it('every guard is run by a test that also feeds it a bad fixture', () => {
    const guards = readRepoFiles((path) => /^tests\/guards\/[^/]+\.ts$/.test(path))
    const tests = readRepoFiles((path) =>
      /^tests\/(?:conventions|meta)\/[^/]+\.test\.ts$/.test(path),
    )
    expect(
      guards.filter((guard) => /^export function check\w+\(/m.test(guard.text)).length,
    ).toBeGreaterThan(30)
    expect(describeViolations(checkSelfTests({ guards, tests }))).toEqual([])
  })

  describe('self-test: the guard fails on a bad fixture', () => {
    const guard = file(
      'tests/guards/new.ts',
      'export function checkNew(input: string) { return [] }',
    )
    const helper = file(
      'tests/guards/helper.ts',
      'export function parse(input: string) { return input }',
    )
    const run = "import { checkNew } from '../guards/new.ts'\nit('holds', () => {})\n"
    const proved = `${run}describe('self-test: the guard fails on a bad fixture', () => {})\n`

    it('accepts a guard whose test has a self-test, and ignores modules that are not guards', () => {
      const tests = [file('tests/conventions/new.test.ts', proved)]
      expect(checkSelfTests({ guards: [guard, helper], tests })).toEqual([])
    })

    it('finds the describe block by its call, not by its text', () => {
      expect(
        hasSelfTestBlock(file('a.test.ts', "describe('self-test: a bad fixture', () => {})")),
      ).toBe(true)
      expect(hasSelfTestBlock(file('a.test.ts', "describe('real repository', () => {})"))).toBe(
        false,
      )
      expect(hasSelfTestBlock(file('a.test.ts', "it('self-test: not a describe', () => {})"))).toBe(
        false,
      )
    })

    it('reports a guard that no test imports', () => {
      expect(checkSelfTests({ guards: [guard], tests: [] })).toEqual([
        {
          rule: 'self-tests/untested',
          file: 'tests/guards/new.ts',
          message:
            'no test of tests/conventions/ or tests/meta/ imports new.ts: a guard runs in a test, on the repository and on a bad fixture',
        },
      ])
    })

    it('reports a guard whose test only runs it on the repository', () => {
      const tests = [file('tests/meta/new.test.ts', run)]
      expect(checkSelfTests({ guards: [guard], tests })).toEqual([
        {
          rule: 'self-tests/no-self-test',
          file: 'tests/guards/new.ts',
          message:
            "tests/meta/new.test.ts runs new.ts but has no describe('self-test: ...') block that feeds it a bad fixture and asserts the exact violation",
        },
      ])
    })

    it('does not take a self-test in a comment or a string for the real thing', () => {
      const text = `${run}// describe('self-test: later', () => {})\nconst note = "describe('self-test: x')"\n`
      expect(
        checkSelfTests({ guards: [guard], tests: [file('tests/meta/new.test.ts', text)] }).map(
          (violation) => violation.rule,
        ),
      ).toEqual(['self-tests/no-self-test'])
    })
  })
})
