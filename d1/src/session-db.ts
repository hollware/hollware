/**
 * drizzle-orm's D1 driver types its client as `D1Database`, but at runtime it only ever calls
 * `prepare` and `batch` (drizzle-orm d1/session.js, d1/driver.js, d1/migrator.js). A
 * `D1DatabaseSession` has exactly those two, so it works at runtime and fails the type check:
 * it lacks `exec`, `withSession` and `dump`.
 *
 * This adapter is a `D1Database` on top of a session without a single cast: the three methods
 * drizzle never calls throw, so a future driver that starts calling one fails loudly.
 */
export function sessionAsDatabase(session: D1DatabaseSession): D1Database {
  const unsupported = (method: string): never => {
    throw new Error(`D1 sessions have no ${method}(): use the primary binding`)
  }
  return {
    prepare: (query) => session.prepare(query),
    batch: <T = unknown>(statements: D1PreparedStatement[]) => session.batch<T>(statements),
    exec: () => unsupported('exec'),
    withSession: () => unsupported('withSession'),
    dump: () => unsupported('dump'),
  }
}
