/**
 * What D1 says when a statement breaks a unique key: `D1_ERROR: UNIQUE constraint failed:
 * entries.site_id, …: SQLITE_CONSTRAINT`, with the same text again in the `cause`. Inside a batch
 * the error arrives as it is, and the batch has rolled back.
 */
export function isUniqueViolation(error: unknown): boolean {
  let current: unknown = error
  for (let depth = 0; depth < 4 && current instanceof Error; depth += 1) {
    if (current.message.includes('UNIQUE constraint failed')) return true
    current = current.cause
  }
  return false
}
