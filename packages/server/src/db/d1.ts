import { drizzle } from 'drizzle-orm/d1'

/**
 * What the store needs of D1: prepare statements and run a batch. A `D1Database` has both, and so
 * does a `D1DatabaseSession` (`env.DB.withSession('first-unconstrained')`, which the RPC reads
 * use), so either one goes in as it is.
 */
export interface D1Like {
  prepare(query: string): D1PreparedStatement
  batch<T = unknown>(statements: D1PreparedStatement[]): Promise<D1Result<T>[]>
}

/**
 * Drizzle's D1 driver is typed over a `D1Database`, but at runtime it only calls `prepare` and
 * `batch` (drizzle-orm d1/session.js), so it also runs on a session. This is a `D1Database` over
 * a `D1Like` without a cast: the three methods drizzle never calls throw, so a driver that starts
 * calling one fails loudly instead of reaching the wrong database (spike S4).
 */
function asD1Database(db: D1Like): D1Database {
  const unavailable = (method: string): never => {
    throw new Error(`The store runs on prepare() and batch() only, so D1 ${method}() is not there`)
  }
  return {
    prepare: (query) => db.prepare(query),
    batch: <T = unknown>(statements: D1PreparedStatement[]) => db.batch<T>(statements),
    exec: () => unavailable('exec'),
    withSession: () => unavailable('withSession'),
    dump: () => unavailable('dump'),
  }
}

/** Drizzle over `db`, with no schema (the store builds its queries from the table objects). */
export function connect(db: D1Like) {
  return drizzle(asD1Database(db))
}

/** The Drizzle database every query of the store runs on. */
export type Db = ReturnType<typeof connect>
