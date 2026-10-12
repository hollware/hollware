import { describe, expect, it } from 'vite-plus/test'
import { checkDisabledTests, testFilesToCheck } from '../guards/disabled-tests.ts'
import { OTHER_TEST_RUNNERS } from '../guards/exceptions.ts'
import { describeViolations } from '../guards/types.ts'
import { file } from '../support/fixtures.ts'
import { readRepoFiles, repoFiles } from '../support/repo.ts'
import { listedTestFiles } from '../support/vitest-list.ts'

// Fails when: a test file that a test project runs, or one under a directory with a runner of its own
// (tests/acceptance/, tests/conformance/), calls `.skip`, `.todo`, `.only`, `.skipIf` or `.runIf` on
// `it`, `test`, `describe`, `suite` or `bench`, or calls `xit`, `xtest` or `xdescribe`.

/** The test files of the repository: what the projects list, and what has a runner of its own. */
function testFiles() {
  const selected = new Set(
    testFilesToCheck({
      files: repoFiles(),
      listed: listedTestFiles().map((entry) => entry.file),
      runnerDirectories: OTHER_TEST_RUNNERS.entries.map((runner) => runner.dir),
    }),
  )
  return readRepoFiles((path) => selected.has(path))
}

describe('disabled tests', () => {
  it('no test file skips, postpones, focuses or conditions a test', () => {
    const tests = testFiles()
    // Both sides must be real: the files of the repo project, of packages and of the Worker apps.
    expect(tests.map((test) => test.path)).toEqual(
      expect.arrayContaining([
        'scripts/break-line.test.ts',
        'tests/meta/disabled-tests.test.ts',
        'packages/core/tests/index.test.ts',
        'apps/playground/test/workerd/health.workerd.test.ts',
        'apps/playground/test/harness/site.test.ts',
        'templates/starter/test/worker.workerd.test.ts',
      ]),
    )
    expect(tests.length).toBeGreaterThan(40)
    expect(describeViolations(checkDisabledTests({ tests }))).toEqual([])
  }, 60_000)

  describe('self-test: the guard fails on a bad fixture', () => {
    const check = (text: string, path = 'tests/meta/a.test.ts') =>
      checkDisabledTests({ tests: [file(path, text)] })

    const rulesOf = (text: string) => check(text).map((violation) => violation.rule)

    it('accepts tests that run, and members that merely sound alike', () => {
      const text = [
        "import { describe, expect, it, test } from 'vite-plus/test'",
        "describe('a', () => { it('b', () => { expect(1).toBe(1) }) })",
        "it.concurrent('c', () => {})",
        "it.fails('d', () => {})",
        "test.each([1, 2])('e %s', () => {})",
        "describe.each([1])('f', () => {})",
        "it.for([1])('g', () => {})",
        'const options = { skip: true, only: false, todo: [] }',
        'const derived = options.skip',
        'derived.only',
        'console.log(options.skip, args.only, list.todo, config.runIf, state.skipIf)',
        'function skip() {}',
        'const only = skip',
        'const xitem = 1',
      ].join('\n')
      expect(check(text)).toEqual([])
    })

    it('does not take a comment, a string, a template or a regular expression for a call', () => {
      const text = [
        "// it.skip('a', () => {})",
        "/* describe.only('b', () => {}) */",
        'const text = "it.only(\'c\')"',
        "const template = `xit('d') ${'x'} test.todo('e')`",
        'const pattern = /test\\.skip\\(|xdescribe/',
      ].join('\n')
      expect(check(text)).toEqual([])
    })

    it('reports a skipped test, naming the form and the line', () => {
      expect(check("it('fine', () => {})\n\nit.skip('later', () => {})")).toEqual([
        {
          rule: 'disabled-tests/disabled',
          file: 'tests/meta/a.test.ts',
          message:
            'line 3 has it.skip: a test that is skipped, left as a todo or run only sometimes proves nothing: delete it, or make it run',
        },
      ])
    })

    it('reports a focused test, which silences every other test of its file', () => {
      expect(check("describe('a', () => {})\ndescribe.only('b', () => {})")).toEqual([
        {
          rule: 'disabled-tests/focused',
          file: 'tests/meta/a.test.ts',
          message:
            'line 2 has describe.only: a focused test makes the runner skip every other test of its file, so a green run proves less than it says: remove .only',
        },
      ])
    })

    it('reports every way to turn a test or a suite off', () => {
      const forms: Record<string, string> = {
        "it.skip('a', () => {})": 'disabled-tests/disabled',
        "it.todo('a')": 'disabled-tests/disabled',
        "it.skipIf(process.env.CI)('a', () => {})": 'disabled-tests/disabled',
        "it.runIf(false)('a', () => {})": 'disabled-tests/disabled',
        "it.only('a', () => {})": 'disabled-tests/focused',
        "test.skip('a', () => {})": 'disabled-tests/disabled',
        "test.only('a', () => {})": 'disabled-tests/focused',
        "describe.skip('a', () => {})": 'disabled-tests/disabled',
        "describe.todo('a')": 'disabled-tests/disabled',
        "describe.skipIf(true)('a', () => {})": 'disabled-tests/disabled',
        "describe.only('a', () => {})": 'disabled-tests/focused',
        "suite.skip('a', () => {})": 'disabled-tests/disabled',
        "bench.skip('a', () => {})": 'disabled-tests/disabled',
        "xit('a', () => {})": 'disabled-tests/disabled',
        "xtest('a', () => {})": 'disabled-tests/disabled',
        "xdescribe('a', () => {})": 'disabled-tests/disabled',
      }
      for (const [text, rule] of Object.entries(forms)) {
        expect(rulesOf(text), text).toEqual([rule])
      }
    })

    it('finds the member behind other members, calls, brackets and aliases', () => {
      const forms: Record<string, string> = {
        "it.concurrent.skip('a', () => {})": 'disabled-tests/disabled',
        "describe.concurrent.only('a', () => {})": 'disabled-tests/focused',
        "it.skip.each([1])('a', () => {})": 'disabled-tests/disabled',
        "it.each([1]).skip('a', () => {})": 'disabled-tests/disabled',
        "it['skip']('a', () => {})": 'disabled-tests/disabled',
        "it?.only('a', () => {})": 'disabled-tests/focused',
        "(it.skip as typeof it)('a', () => {})": 'disabled-tests/disabled',
        "(it).skip('a', () => {})": 'disabled-tests/disabled',
        "it!.skip('a', () => {})": 'disabled-tests/disabled',
        "(it as TestAPI).only('a', () => {})": 'disabled-tests/focused',
        "(it satisfies TestAPI).skip('a', () => {})": 'disabled-tests/disabled',
        "(it?.each([1])).skip('a', () => {})": 'disabled-tests/disabled',
        'const off = it.skip': 'disabled-tests/disabled',
        "xit.each([1])('a', () => {})": 'disabled-tests/disabled',
        "import { it as spec } from 'vite-plus/test'\nspec.skip('a', () => {})":
          'disabled-tests/disabled',
        "import { describe as group } from 'vitest'\ngroup.only('a', () => {})":
          'disabled-tests/focused',
        "const custom = test.extend({})\ncustom.skip('a', () => {})": 'disabled-tests/disabled',
        "const slow = it.concurrent\nconst slower = slow\nslower.only('a', () => {})":
          'disabled-tests/focused',
        // The names may be declared in any order.
        "const alias = base\nconst base = it\nalias.skip('a', () => {})": 'disabled-tests/disabled',
      }
      for (const [text, rule] of Object.entries(forms)) {
        // One violation per form, however many calls and members surround it.
        expect(rulesOf(text), text).toEqual([rule])
      }
    })

    it('reports every occurrence of a file, in order, and each file on its own', () => {
      const text = "it.skip('a', () => { it.only('b', () => {}) })\ntest.todo('c')"
      expect(check(text).map((violation) => violation.message.split(':')[0])).toEqual([
        'line 1 has it.skip',
        'line 1 has it.only',
        'line 2 has test.todo',
      ])
      const result = checkDisabledTests({
        tests: [file('a/x.test.ts', "it.skip('a')"), file('b/y.test.ts', "it('b')")],
      })
      expect(result.map((violation) => violation.file)).toEqual(['a/x.test.ts'])
    })

    it('reads the files a project lists, those named like tests, and every source file of a runner directory', () => {
      const select = (files: string[], listed: string[] = []) =>
        testFilesToCheck({ files, listed, runnerDirectories: ['tests/acceptance/'] })
      expect(
        select(
          [
            'a/x.test.ts',
            'b/y.spec.mts',
            'c/z.workerd.test.ts',
            'd/listed-but-not-named.ts',
            'tests/acceptance/f0/helper.ts',
            'tests/acceptance/f0/a.test.ts',
            'tests/acceptance/notes.md',
            'tests/acceptancex/helper.ts',
            'src/index.ts',
          ],
          ['d/listed-but-not-named.ts'],
        ),
      ).toEqual([
        'a/x.test.ts',
        'b/y.spec.mts',
        'c/z.workerd.test.ts',
        'd/listed-but-not-named.ts',
        'tests/acceptance/f0/helper.ts',
        'tests/acceptance/f0/a.test.ts',
      ])
      // A listing of a file that the repository does not have selects nothing.
      expect(select(['src/index.ts'], ['gone.test.ts'])).toEqual([])
    })

    it('reports a file that does not parse, which nobody can vouch for', () => {
      const result = check("it.skip('a', () => {")
      expect(result.map((violation) => violation.rule)).toContain('disabled-tests/syntax-error')
      expect(result[0]?.message).toContain('the file does not parse')
    })
  })
})
