export function isUniqueViolation(error: unknown): boolean {
  let current: unknown = error
  for (let depth = 0; depth < 4 && current instanceof Error; depth += 1) {
    if (current.message.includes('UNIQUE constraint failed')) return true
    current = current.cause
  }
  return false
}
