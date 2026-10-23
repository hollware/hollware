import { drizzle } from 'drizzle-orm/d1'

export interface D1Like {
  prepare(query: string): D1PreparedStatement
  batch<T = unknown>(statements: D1PreparedStatement[]): Promise<D1Result<T>[]>
}

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

export function connect(db: D1Like) {
  return drizzle(asD1Database(db))
}

export type Db = ReturnType<typeof connect>
