import type { Violation } from './types.ts'

/**
 * Guard `test-projects`: every test file belongs to a test project, so none is written and
 * then never run. The files Vitest lists (`vp test list --filesOnly`) must include every
 * `*.test.*` and `*.spec.*` file of the repository, except those in the directories that
 * have a runner of their own (`tests/acceptance/`, `tests/conformance/`; the same ones the
 * root `vite.config.ts` excludes from the `repo` project).
 */

export interface TestProjectsInput {
  /** The test files of the repository, repository-relative. */
  testFiles: readonly string[]
  /** The test files Vitest lists across all of its projects, repository-relative. */
  listed: readonly string[]
  /** Directories with their own runner, with a trailing `/`. */
  separateRunners: readonly string[]
}

const TEST_FILE = /\.(?:test|spec)\.[cm]?[jt]sx?$/

/** Whether a repository file is a test file. */
export function isTestFile(path: string): boolean {
  return TEST_FILE.test(path)
}

export function checkTestProjects(input: TestProjectsInput): Violation[] {
  const violations: Violation[] = []
  const listed = new Set(input.listed)
  for (const path of input.testFiles) {
    if (listed.has(path)) continue
    if (input.separateRunners.some((directory) => path.startsWith(directory))) continue
    violations.push({
      rule: 'test-projects/orphan',
      file: path,
      message:
        'no test project runs this file: move it under a package, under tests/, or into an include of a project in vite.config.ts, or it is never run',
    })
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
