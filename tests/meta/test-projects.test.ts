import { describe, expect, it } from 'vite-plus/test'
import rootConfig from '../../vite.config.ts'
import { OTHER_TEST_RUNNERS } from '../guards/exceptions.ts'
import {
  checkTestProjects,
  excludedDirectories,
  isTestFile,
  type TestProjectsInput,
} from '../guards/test-projects.ts'
import { describeViolations } from '../guards/types.ts'
import { parseWorkflow } from '../guards/workflow-model.ts'
import { file } from '../support/fixtures.ts'
import { readText, repoFiles } from '../support/repo.ts'
import { isRecord, isStringArray, recordAt, stringAt } from '../support/values.ts'
import { listedTestFiles } from '../support/vitest-list.ts'
import { taskGraph, vpRunTasks } from '../support/vp.ts'

// Fails when: a *.test.* or *.spec.* file exists that no test project of `vp test` lists; a test file
// is added to a project's exclude; the directories with their own runner stop matching what the `repo`
// project excludes in vite.config.ts; or a test file exists in such a directory and its task is not
// defined in the root vite.config.ts, or neither check:push nor a `run:` step of ci.yml runs it.

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

/** The name of the root package, which `vp run <name>#<task>` may qualify a task with. */
function rootPackageName(): string | undefined {
  const manifest: unknown = JSON.parse(readText('package.json'))
  return stringAt(manifest, 'name')
}

/** The tasks that the `run:` steps of ci.yml run. */
function ciTasks(): string[] {
  const path = '.github/workflows/ci.yml'
  const workflow = parseWorkflow(file(path, readText(path)))
  expect(workflow.errors).toEqual([])
  return workflow.jobs
    .flatMap((job) => job.steps)
    .flatMap((step) => (step.run === undefined ? [] : vpRunTasks(step.run, rootPackageName())))
}

describe('test projects', () => {
  it('every test file of the repository is listed by a project of `vp test`, or runs through a task CI runs', () => {
    const listed = listedTestFiles()
    const testFiles = repoFiles().filter(isTestFile)
    // Both sides must be real: this suite and the playground's workerd tests are in them.
    expect(listed.map((entry) => entry.file)).toEqual(
      expect.arrayContaining([
        'scripts/break-line.test.ts',
        'tests/meta/test-projects.test.ts',
        'packages/core/tests/index.test.ts',
        'apps/playground/test/workerd/gateway.workerd.test.ts',
        'apps/playground/test/workerd/handlers.workerd.test.ts',
        'templates/starter/test/worker.workerd.test.ts',
      ]),
    )
    // So must the tasks: CI runs check:push, which runs the build, the types and publint.
    const tasks = taskGraph(rootConfig, rootPackageName())
    expect(tasks['check:push']).toEqual(expect.arrayContaining(['build', 'publint', 'types:check']))
    expect(ciTasks()).toContain('check:push')
    const violations = checkTestProjects({
      testFiles,
      listed: listed.map((entry) => entry.file),
      separateRunners: OTHER_TEST_RUNNERS.entries,
      tasks,
      ciTasks: ciTasks(),
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
      'apps/playground/test/workerd/config.workerd.test.ts',
      'apps/playground/test/workerd/database.workerd.test.ts',
      'apps/playground/test/workerd/entrypoint.workerd.test.ts',
      'apps/playground/test/workerd/gateway.workerd.test.ts',
      'apps/playground/test/workerd/handlers.workerd.test.ts',
      'apps/playground/test/workerd/node-globals.workerd.test.ts',
    ])
    expect(inProject('playground:harness')).toEqual([
      'apps/playground/test/harness/client.test.ts',
      'apps/playground/test/harness/gateway.test.ts',
      'apps/playground/test/harness/identity.test.ts',
      'apps/playground/test/harness/node-globals.test.ts',
      'apps/playground/test/harness/nuxt-site.test.ts',
      'apps/playground/test/harness/rpc.test.ts',
      'apps/playground/test/harness/site.test.ts',
    ])
  }, 60_000)

  it('the directories with their own runner are exactly those the repo project excludes', () => {
    expect(excludedDirectories(repoProjectExcludes()).sort()).toEqual(
      OTHER_TEST_RUNNERS.entries.map((runner) => runner.dir).sort(),
    )
  })

  describe('self-test: the guard fails on a bad fixture', () => {
    const check = (input: Partial<TestProjectsInput>) =>
      checkTestProjects({
        testFiles: [],
        listed: [],
        separateRunners: [],
        tasks: {},
        ciTasks: [],
        ...input,
      })

    const ACCEPTANCE = [{ dir: 'tests/acceptance/', task: 'test:acceptance' }]
    const ACCEPTANCE_TESTS = ['tests/acceptance/f0/a.test.ts']

    it('accepts test files that a project lists', () => {
      expect(
        check({
          testFiles: ['a/x.test.ts', 'b/y.spec.ts'],
          listed: ['a/x.test.ts', 'b/y.spec.ts', 'c/z.test.ts'],
        }),
      ).toEqual([])
    })

    it('reports a test file that no project lists', () => {
      expect(
        check({ testFiles: ['a/x.test.ts', 'orphan/y.test.ts'], listed: ['a/x.test.ts'] }),
      ).toEqual([
        {
          rule: 'test-projects/orphan',
          file: 'orphan/y.test.ts',
          message:
            'no test project runs this file: move it under a package, under tests/, or into an include of a project in vite.config.ts, or it is never run',
        },
      ])
    })

    it('does not require a listing for a file in a directory with its own runner that CI runs', () => {
      const runs = { tasks: { 'test:acceptance': [] }, ciTasks: ['test:acceptance'] }
      expect(check({ testFiles: ACCEPTANCE_TESTS, separateRunners: ACCEPTANCE, ...runs })).toEqual(
        [],
      )
      expect(
        check({
          testFiles: ['tests/acceptancex/a.test.ts'],
          separateRunners: ACCEPTANCE,
          ...runs,
        }),
      ).toHaveLength(1)
    })

    it('reports tests in a runner directory whose task the root config does not define', () => {
      expect(
        check({
          testFiles: ACCEPTANCE_TESTS,
          separateRunners: ACCEPTANCE,
          tasks: { 'check:push': ['build'] },
          ciTasks: ['check:push'],
        }),
      ).toEqual([
        {
          rule: 'test-projects/runner-task-missing',
          file: 'tests/acceptance/',
          message:
            'the tests here run with `vp run test:acceptance`, which is not a task of the root vite.config.ts: define it in run.tasks, or `vp test` and CI never run these tests',
        },
      ])
      // A name that every object inherits is not a task of the config.
      const inherited = check({
        testFiles: ACCEPTANCE_TESTS,
        separateRunners: [{ dir: 'tests/acceptance/', task: 'constructor' }],
      })
      expect(inherited.map((violation) => violation.rule)).toEqual([
        'test-projects/runner-task-missing',
      ])
    })

    it('reports a task that neither check:push nor a step of ci.yml runs', () => {
      expect(
        check({
          testFiles: ACCEPTANCE_TESTS,
          separateRunners: ACCEPTANCE,
          tasks: { 'check:push': ['build'], 'test:acceptance': [], build: [] },
          ciTasks: ['check:push'],
        }),
      ).toEqual([
        {
          rule: 'test-projects/runner-task-not-run',
          file: 'tests/acceptance/',
          message:
            'the tests here run with `vp run test:acceptance`, which neither check:push nor a run: step of .github/workflows/ci.yml runs: add it to check:push or to the CI workflow, or nothing runs these tests',
        },
      ])
    })

    it('accepts a task that check:push runs, however far down, or that CI runs on its own', () => {
      const separateRunners = ACCEPTANCE
      const testFiles = ACCEPTANCE_TESTS
      const defined = { 'test:acceptance': [], 'check:push': ['test:acceptance'] }
      expect(
        check({ testFiles, separateRunners, tasks: defined, ciTasks: ['check:push'] }),
      ).toEqual([])
      const deep = { 'test:acceptance': [], 'check:push': ['stages'], stages: ['test:acceptance'] }
      expect(check({ testFiles, separateRunners, tasks: deep, ciTasks: ['check:push'] })).toEqual(
        [],
      )
      const alone = { 'test:acceptance': [], 'check:push': ['build'], build: [] }
      expect(
        check({
          testFiles,
          separateRunners,
          tasks: alone,
          ciTasks: ['check:push', 'test:acceptance'],
        }),
      ).toEqual([])
    })

    it('does not credit check:push when CI does not run it, and survives tasks that run each other', () => {
      const tasks = { 'test:acceptance': [], 'check:push': ['test:acceptance'], a: ['b'], b: ['a'] }
      const result = check({
        testFiles: ACCEPTANCE_TESTS,
        separateRunners: ACCEPTANCE,
        tasks,
        ciTasks: ['a'],
      })
      expect(result.map((violation) => violation.rule)).toEqual([
        'test-projects/runner-task-not-run',
      ])
    })

    it('asks nothing of a runner directory without test files, and judges each runner on its own', () => {
      // No test file yet: the task need not exist.
      expect(
        check({
          testFiles: ['a/x.test.ts'],
          listed: ['a/x.test.ts'],
          separateRunners: ACCEPTANCE,
        }),
      ).toEqual([])
      const two = [...ACCEPTANCE, { dir: 'tests/conformance/', task: 'test:conformance' }]
      const result = check({
        testFiles: ['tests/acceptance/a.test.ts', 'tests/conformance/b.test.ts'],
        separateRunners: two,
        tasks: { 'test:acceptance': [] },
        ciTasks: ['test:acceptance'],
      })
      expect(result.map((violation) => `${violation.file} ${violation.rule}`)).toEqual([
        'tests/conformance/ test-projects/runner-task-missing',
      ])
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
