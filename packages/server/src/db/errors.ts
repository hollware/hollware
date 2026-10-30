export function isUniqueViolation(error: unknown): boolean {
  let current: unknown = error
  for (let depth = 0; depth < 4 && current instanceof Error; depth += 1) {
    if (current.message.includes('UNIQUE constraint failed')) return true
    current = current.cause
  }
  return false
}

export const GUARD_FAILED = 'hollware: a guard of the batch failed'

export function isGuardFailure(error: unknown): boolean {
  return error instanceof Error && /malformed JSON/i.test(`${error.message} ${String(error.cause)}`)
}
