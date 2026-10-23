import { analyzeSource } from '../support/source.ts'
import { packageOf } from './declared-imports.ts'
import type { TextFile, Violation } from './types.ts'

export interface AdminIsolationInput {
  sources: readonly TextFile[]
}

export const ADMIN_PACKAGE = '@hollware/admin'

export function checkAdminIsolation(input: AdminIsolationInput): Violation[] {
  const violations: Violation[] = []
  for (const file of input.sources) {
    if (file.path.startsWith('packages/admin/')) continue
    const isViteConfig = /(^|\/)vite\.config\.ts$/.test(file.path)
    for (const reference of analyzeSource(file.path, file.text).references) {
      if (isViteConfig && reference.specifier === ADMIN_PACKAGE) continue
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
