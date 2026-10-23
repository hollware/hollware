import type { Violation } from './types.ts'

export interface TestRunnerDirectory {
  dir: string
  task: string
}

export interface TestProjectsInput {
  testFiles: readonly string[]
  listed: readonly string[]
  separateRunners: readonly TestRunnerDirectory[]
  tasks: Readonly<Record<string, readonly string[]>>
  ciTasks: readonly string[]
}

const TEST_FILE = /\.(?:test|spec)\.[cm]?[jt]sx?$/

export function isTestFile(path: string): boolean {
  return TEST_FILE.test(path)
}

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

export function excludedDirectories(globs: readonly string[]): string[] {
  return globs.flatMap((glob) => {
    const match = /^(.+)\/\*\*$/.exec(glob)
    return match?.[1] === undefined ? [] : [`${match[1]}/`]
  })
}
