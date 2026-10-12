import { spawnSync } from 'node:child_process'
import { join, relative } from 'node:path'
import { REPO_ROOT } from './repo.ts'
import { isRecord } from './values.ts'

/**
 * The test files Vitest lists across all projects of the repository, repository-relative,
 * as `vp test list --filesOnly --json` prints them. Nothing is run. The project-local `vp`
 * is used: a global one of another version breaks the Cloudflare plugin.
 */
export function listedTestFiles(): { file: string; project: string }[] {
  // A child of a test run must not believe it is a test worker itself.
  const env = Object.fromEntries(
    Object.entries(process.env).filter(([name]) => !name.startsWith('VITEST')),
  )
  const result = spawnSync(
    join(REPO_ROOT, 'node_modules/.bin/vp'),
    ['test', 'list', '--filesOnly', '--json'],
    { cwd: REPO_ROOT, encoding: 'utf8', env, maxBuffer: 64 * 1024 * 1024, timeout: 60_000 },
  )
  if (result.error !== undefined) throw result.error
  if (result.status !== 0) {
    throw new Error(`vp test list failed (${result.status}): ${result.stderr || result.stdout}`)
  }
  const start = result.stdout.indexOf('[')
  const parsed: unknown = JSON.parse(result.stdout.slice(start))
  if (!Array.isArray(parsed)) throw new Error('vp test list --json did not print an array')
  return parsed.map((entry: unknown) => {
    if (
      !isRecord(entry) ||
      typeof entry.file !== 'string' ||
      typeof entry.projectName !== 'string'
    ) {
      throw new Error(`unexpected entry in the output of vp test list: ${JSON.stringify(entry)}`)
    }
    return {
      file: relative(REPO_ROOT, entry.file).split('\\').join('/'),
      project: entry.projectName,
    }
  })
}
