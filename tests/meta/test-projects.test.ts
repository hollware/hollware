import { describe, expect, it } from 'vite-plus/test'
import rootConfig from '../../vite.config.ts'
import { exceptionValues, OTHER_TEST_RUNNERS } from '../guards/exceptions.ts'
import { checkTestProjects, excludedDirectories, isTestFile } from '../guards/test-projects.ts'
import { describeViolations } from '../guards/types.ts'
import { repoFiles } from '../support/repo.ts'
import { isRecord, isStringArray, recordAt } from '../support/values.ts'
import { listedTestFiles } from '../support/vitest-list.ts'

// Fails when: a *.test.* or *.spec.* file exists that no test project of `vp test` lists, a test
// file is added to a project's exclude, or the directories with their own runner stop matching
// what the `repo` project excludes in vite.config.ts.

function repoProjectExcludes(): string[] {
  const config: unknown = rootConfig
  const projects = recordAt(config, 'test')?.projects
  if (!Array.isArray(projects)) throw new Error('vite.config.ts has no test.projects')
  for (const project of projects) {
    const test = recordAt(project, 'test')
    if (isRecord(test) && test.name === 'repo' && isStringArray(test.exclude)) return test.exclude
  }
  throw new Error('vite.config.ts has no inline project named "repo" with an exclude')
}

describe('test projects', () => {
  it('every test file of the repository is listed by a project of `vp test`', () => {
    const listed = listedTestFiles()
    const testFiles = repoFiles().filter(isTestFile)
    // Both sides must be real: this suite and the playground's workerd tests are in them.
    expect(listed.map((entry) => entry.file)).toEqual(
      expect.arrayContaining([
        'scripts/break-line.test.ts',
        'tests/meta/test-projects.test.ts',
        'packages/core/tests/index.test.ts',
        'apps/playground/test/workerd/health.workerd.test.ts',
        'templates/starter/test/worker.workerd.test.ts',
      ]),
    )
    const violations = checkTestProjects({
      testFiles,
      listed: listed.map((entry) => entry.file),
      separateRunners: exceptionValues(OTHER_TEST_RUNNERS),
    })
    expect(describeViolations(violations)).toEqual([])
  }, 60_000)

  it('the playground has the two projects AGENTS.md names, workerd and harness', () => {
    const inProject = (project: string) =>
      listedTestFiles()
        .filter((entry) => entry.project === project)
        .map((entry) => entry.file)
        .sort()
    expect(inProject('playground:workerd')).toEqual([
      'apps/playground/test/workerd/database.workerd.test.ts',
      'apps/playground/test/workerd/health.workerd.test.ts',
    ])
    expect(inProject('playground:harness')).toEqual(['apps/playground/test/harness/site.test.ts'])
  }, 60_000)

  it('the directories with their own runner are exactly those the repo project excludes', () => {
    expect(excludedDirectories(repoProjectExcludes()).sort()).toEqual(
      exceptionValues(OTHER_TEST_RUNNERS).sort(),
    )
  })

  describe('self-test: the guard fails on a bad fixture', () => {
    const check = (testFiles: string[], listed: string[], separateRunners: string[] = []) =>
      checkTestProjects({ testFiles, listed, separateRunners })

    it('accepts test files that a project lists', () => {
      expect(
        check(['a/x.test.ts', 'b/y.spec.ts'], ['a/x.test.ts', 'b/y.spec.ts', 'c/z.test.ts']),
      ).toEqual([])
    })

    it('reports a test file that no project lists', () => {
      expect(check(['a/x.test.ts', 'orphan/y.test.ts'], ['a/x.test.ts'])).toEqual([
        {
          rule: 'test-projects/orphan',
          file: 'orphan/y.test.ts',
          message:
            'no test project runs this file: move it under a package, under tests/, or into an include of a project in vite.config.ts, or it is never run',
        },
      ])
    })

    it('does not require a file in a directory with its own runner', () => {
      expect(check(['tests/acceptance/f0/a.test.ts'], [], ['tests/acceptance/'])).toEqual([])
      expect(check(['tests/acceptancex/a.test.ts'], [], ['tests/acceptance/'])).toHaveLength(1)
    })

    it('recognizes test files by name', () => {
      for (const path of [
        'a.test.ts',
        'a.spec.ts',
        'a.workerd.test.ts',
        'a.test.mts',
        'a.test.tsx',
        'a.spec.js',
      ]) {
        expect(isTestFile(path)).toBe(true)
      }
      for (const path of ['a.ts', 'test.ts', 'a.tests.ts', 'a.test.md', 'attest.ts']) {
        expect(isTestFile(path)).toBe(false)
      }
    })

    it('reads the directories out of exclude globs', () => {
      expect(excludedDirectories(['tests/acceptance/**', '**/*.d.ts', 'a/b/**'])).toEqual([
        'tests/acceptance/',
        'a/b/',
      ])
    })
  })
})
