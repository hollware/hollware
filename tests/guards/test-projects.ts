import type { Violation } from './types.ts'

/**
 * Guard `test-projects`: every test file belongs to a test project, so none is written and
 * then never run. The files Vitest lists (`vp test list --filesOnly`) must include every
 * `*.test.*` and `*.spec.*` file of the repository, except those in the directories that
 * have a runner of their own (`tests/acceptance/`, `tests/conformance/`; the same ones the
 * root `vite.config.ts` excludes from the `repo` project).
 *
 * That exemption is not an exemption from running. Each of those directories names the task
 * that runs its tests, and as soon as a test file exists there the task must be one of the
 * `run.tasks` of the root `vite.config.ts`, and CI must run it: through `check:push`, which
 * `ci.yml` runs, or in a `run:` step of `ci.yml` of its own. A task that CI does not reach, by
 * `vp run` or by `dependsOn`, runs nowhere but on a machine that remembers to.
 */

/** A directory whose tests run through a task of their own. */
export interface TestRunnerDirectory {
  /** The directory, with a trailing `/`. */
  dir: string
  /** The task that runs its tests: `vp run <task>`. */
  task: string
}

export interface TestProjectsInput {
  /** The test files of the repository, repository-relative. */
  testFiles: readonly string[]
  /** The test files Vitest lists across all of its projects, repository-relative. */
  listed: readonly string[]
  /** Directories with their own runner, and the task that runs each. */
  separateRunners: readonly TestRunnerDirectory[]
  /**
   * The tasks of the root `vite.config.ts`, each with the tasks it runs: those its commands run
   * with `vp run`, and those in its `dependsOn`.
   */
  tasks: Readonly<Record<string, readonly string[]>>
  /** The tasks that the `run:` steps of `.github/workflows/ci.yml` run. */
  ciTasks: readonly string[]
}

const TEST_FILE = /\.(?:test|spec)\.[cm]?[jt]sx?$/

/** Whether a repository file is a test file. */
export function isTestFile(path: string): boolean {
  return TEST_FILE.test(path)
}

/** The tasks that run when the `start` tasks run: themselves, what they run, and so on. */
function reachableTasks(
  start: readonly string[],
  tasks: Readonly<Record<string, readonly string[]>>,
): Set<string> {
  const reached = new Set<string>()
  const pending = [...start]
  for (let task = pending.pop(); task !== undefined; task = pending.pop()) {
    if (reached.has(task)) continue
    reached.add(task)
    if (Object.hasOwn(tasks, task)) pending.push(...(tasks[task] ?? []))
  }
  return reached
}

export function checkTestProjects(input: TestProjectsInput): Violation[] {
  const violations: Violation[] = []
  const listed = new Set(input.listed)
  for (const path of input.testFiles) {
    if (listed.has(path)) continue
    if (input.separateRunners.some((runner) => path.startsWith(runner.dir))) continue
    violations.push({
      rule: 'test-projects/orphan',
      file: path,
      message:
        'no test project runs this file: move it under a package, under tests/, or into an include of a project in vite.config.ts, or it is never run',
    })
  }

  const run = reachableTasks(input.ciTasks, input.tasks)
  for (const { dir, task } of input.separateRunners) {
    if (!input.testFiles.some((path) => path.startsWith(dir))) continue
    if (!Object.hasOwn(input.tasks, task)) {
      violations.push({
        rule: 'test-projects/runner-task-missing',
        file: dir,
        message: `the tests here run with \`vp run ${task}\`, which is not a task of the root vite.config.ts: define it in run.tasks, or \`vp test\` and CI never run these tests`,
      })
    } else if (!run.has(task)) {
      violations.push({
        rule: 'test-projects/runner-task-not-run',
        file: dir,
        message: `the tests here run with \`vp run ${task}\`, which neither check:push nor a run: step of .github/workflows/ci.yml runs: add it to check:push or to the CI workflow, or nothing runs these tests`,
      })
    }
  }
  return violations
}

/**
 * The `<dir>/` directories excluded by globs of the form `<dir>/**`, so the list of separate
 * runners can be compared with the `exclude` of the `repo` project.
 */
export function excludedDirectories(globs: readonly string[]): string[] {
  return globs.flatMap((glob) => {
    const match = /^(.+)\/\*\*$/.exec(glob)
    return match?.[1] === undefined ? [] : [`${match[1]}/`]
  })
}
