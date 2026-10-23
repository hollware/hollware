import { execFileSync } from 'node:child_process'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

export const COMMIT_TYPES = [
  'feat',
  'fix',
  'docs',
  'chore',
  'refactor',
  'test',
  'ci',
  'build',
  'perf',
  'style',
  'revert',
] as const

export const DEFAULT_RANGE = 'origin/main..HEAD'

const CONVENTIONAL = new RegExp(
  `^(?:${COMMIT_TYPES.join('|')})(?:\\([a-z0-9][a-z0-9./-]*\\))?!?: \\S`,
)
const VERSION_PACKAGES = /^Version Packages(?: \(rc\))?(?: \(#\d+\))?$/

export function invalidSubjects(subjects: readonly string[]): string[] {
  return subjects.filter(
    (subject) => !CONVENTIONAL.test(subject) && !VERSION_PACKAGES.test(subject),
  )
}

export function readSubjects(range: string, cwd: string): string[] {
  const output = execFileSync('git', ['log', '--no-merges', '--format=%s', range, '--'], {
    cwd,
    encoding: 'utf8',
  })
  return output.split('\n').filter((line) => line !== '')
}

export function main(args: readonly string[], cwd: string): number {
  const range = args[0] ?? DEFAULT_RANGE
  const invalid = invalidSubjects(readSubjects(range, cwd))
  for (const subject of invalid) {
    console.error(`commit-subjects: not a Conventional Commit: ${JSON.stringify(subject)}`)
  }
  if (invalid.length > 0) {
    console.error(
      `commit-subjects: write each subject as type(scope)!: subject, with a type of ${COMMIT_TYPES.join(', ')}`,
    )
    return 1
  }
  return 0
}

const invoked = process.argv[1]
if (invoked !== undefined && pathToFileURL(resolve(invoked)).href === import.meta.url) {
  process.exit(main(process.argv.slice(2), resolve(import.meta.dirname, '..')))
}
