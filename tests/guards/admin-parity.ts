import type { TextFile, Violation } from './types.ts'

export interface AdminParityInput {
  operations: readonly string[]
  admin: readonly TextFile[]
  exceptions: readonly string[]
}

function calledIn(text: string): string[] {
  return [...text.matchAll(/\bcall\(\s*'([a-z_]+)'/g)].flatMap((match) =>
    match[1] === undefined ? [] : [match[1]],
  )
}

export function checkAdminParity(input: AdminParityInput): Violation[] {
  const called = new Set(input.admin.flatMap((file) => calledIn(file.text)))
  const violations: Violation[] = []
  for (const operation of input.operations) {
    if (!called.has(operation) && !input.exceptions.includes(operation)) {
      violations.push({
        rule: 'admin-parity/missing',
        file: 'packages/admin',
        message: `no page of the admin calls ${operation}: give a person a way to do it, or say in OPERATIONS_WITHOUT_ADMIN how they do it there.`,
      })
    }
  }
  for (const exception of input.exceptions) {
    if (!input.operations.includes(exception)) {
      violations.push({
        rule: 'admin-parity/unknown',
        file: 'tests/guards/exceptions.ts',
        message: `OPERATIONS_WITHOUT_ADMIN names ${exception}, which is no operation: remove it.`,
      })
    } else if (called.has(exception)) {
      violations.push({
        rule: 'admin-parity/stale',
        file: 'tests/guards/exceptions.ts',
        message: `OPERATIONS_WITHOUT_ADMIN names ${exception}, which the admin calls: remove it.`,
      })
    }
  }
  return violations
}
