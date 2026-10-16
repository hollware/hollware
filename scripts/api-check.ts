/**
 * The breaks of the public API between a version and the code (ADR-036): reads `api/` as it was at
 * a git ref, such as the tag of the last release, and as the code makes it now, and lists what of
 * the change a minor version cannot carry (scripts/api-compat.ts).
 *
 *   node scripts/api-check.ts --against @hollware/core@1.0.0
 *
 * It exits 1 when there is a break, and 0 when there is none or the ref has no `api/` yet.
 */
import { execFileSync } from 'node:child_process'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { breakingChanges } from './api-compat.ts'
import { surfaceOf } from './api.ts'

/** The parts of `api/` at a ref, or `null` when the ref has none. */
export function partsAt(root: string, ref: string, files: readonly string[]) {
  const parts: Record<string, Record<string, unknown>> = {}
  for (const file of files) {
    try {
      const text = execFileSync('git', ['show', `${ref}:api/${file}`], {
        cwd: root,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore'],
      })
      parts[file] = JSON.parse(text)
    } catch {
      return null
    }
  }
  return parts
}

export async function main(root: string, argv: readonly string[]): Promise<number> {
  const at = argv.indexOf('--against')
  const ref = argv[at + 1]
  if (at === -1 || ref === undefined) {
    console.error('Usage: node scripts/api-check.ts --against <git ref>')
    return 2
  }
  const now = await surfaceOf(root)
  const before = partsAt(root, ref, Object.keys(now))
  if (before === null) {
    console.log(`${ref} has no api/: nothing to compare with.`)
    return 0
  }
  const breaks = breakingChanges(before, now)
  if (breaks.length === 0) {
    console.log(`Nothing breaks since ${ref}: the change fits a minor version.`)
    return 0
  }
  console.error(
    `What breaks since ${ref}, which needs a major version:\n${breaks.map((line) => `  - ${line}`).join('\n')}`,
  )
  return 1
}

const invoked = process.argv[1]
if (invoked !== undefined && pathToFileURL(resolve(invoked)).href === import.meta.url) {
  main(resolve(import.meta.dirname, '..'), process.argv.slice(2)).then(
    (code) => process.exit(code),
    (error: unknown) => {
      console.error(error)
      process.exit(1)
    },
  )
}
