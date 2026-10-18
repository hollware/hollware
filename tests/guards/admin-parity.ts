import type { TextFile, Violation } from './types.ts'

/**
 * Guard `admin-parity`: what an agent does over MCP, a person does in the admin. Every operation
 * is called by name somewhere in the admin (`api.call('<name>', …)`), unless
 * `OPERATIONS_WITHOUT_ADMIN` says how a person does it there instead; an exception the admin
 * calls after all, or that names no operation, is reported too.
 */

export interface AdminParityInput {
  /** The names of the operations, as `OPERATIONS` of `@hollware/core` lists them. */
  operations: readonly string[]
  /** The source files of the admin. */
  admin: readonly TextFile[]
  /** The values of `OPERATIONS_WITHOUT_ADMIN`. */
  exceptions: readonly string[]
}

/** The operations a file calls by name through the client of the admin. */
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
