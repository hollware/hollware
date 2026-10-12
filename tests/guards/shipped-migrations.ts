import type { Violation } from './types.ts'

/**
 * Guard `shipped-migrations`: a migration that a release of `@hollware/server` shipped is never
 * edited or removed (ADR-023). Users apply the files of `migrations/` to their own databases,
 * and D1 records a migration by its file name: an edited file never runs again where it already
 * ran, and runs differently where it had not.
 *
 * The releases are the git tags `@hollware/server@<version>`. The guard compares every
 * migration file a tag holds with the same file in the working tree, byte for byte.
 */

export interface ShippedMigrationsInput {
  /** Each release tag and the migration files it holds, by file name. */
  releases: readonly { tag: string; files: Readonly<Record<string, string>> }[]
  /** The migration files of the working tree, by file name. */
  current: Readonly<Record<string, string>>
}

export function checkShippedMigrations(input: ShippedMigrationsInput): Violation[] {
  const shippedBy = new Map<string, { tags: string[]; text: string }>()
  for (const release of input.releases) {
    for (const [name, text] of Object.entries(release.files)) {
      const known = shippedBy.get(name)
      if (known === undefined) shippedBy.set(name, { tags: [release.tag], text })
      else known.tags.push(release.tag)
    }
  }
  const violations: Violation[] = []
  for (const [name, { tags, text }] of [...shippedBy].sort(([a], [b]) => a.localeCompare(b))) {
    const file = `packages/server/migrations/${name}`
    const releases = tags.join(', ')
    const current = input.current[name]
    if (current === undefined) {
      violations.push({
        rule: 'shipped-migrations/removed',
        file,
        message: `shipped by ${releases} and now missing: a shipped migration stays, and a change goes in a new migration`,
      })
    } else if (current !== text) {
      violations.push({
        rule: 'shipped-migrations/edited',
        file,
        message: `shipped by ${releases} and changed since: never edit a shipped migration; fix forward with a new one`,
      })
    }
  }
  return violations
}
