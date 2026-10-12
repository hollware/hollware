import { analyzeSource } from '../support/source.ts'
import { packageOf } from './declared-imports.ts'
import type { TextFile, Violation } from './types.ts'

/**
 * Guard `admin-isolation`: `@hollware/admin` is a prebuilt single-page app that the Worker
 * serves as static assets. It never enters the Worker bundle, so no code outside
 * `packages/admin` imports it (`packages/admin/AGENTS.md`). A project may still depend on the
 * package to get its built files; what is forbidden is an `import` of it.
 */

export interface AdminIsolationInput {
  /** The source files of the repository, with their text. */
  sources: readonly TextFile[]
}

export const ADMIN_PACKAGE = '@hollware/admin'

export function checkAdminIsolation(input: AdminIsolationInput): Violation[] {
  const violations: Violation[] = []
  for (const file of input.sources) {
    if (file.path.startsWith('packages/admin/')) continue
    for (const reference of analyzeSource(file.path, file.text).references) {
      if (packageOf(reference.specifier) === ADMIN_PACKAGE) {
        violations.push({
          rule: 'admin-isolation/import',
          file: file.path,
          message: `line ${reference.line} imports "${reference.specifier}": the admin is served as static assets and never enters the Worker bundle`,
        })
      }
    }
  }
  return violations
}
