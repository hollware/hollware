/**
 * The D1 store: `createD1Store(db, { clock? })` implements the `ContentStore` of `ports.ts` over a
 * D1 database or a D1 session. Only the code that composes the Worker imports this; handlers see
 * the port and run on fakes.
 */
export type { D1Like } from './d1.ts'
export { createD1Store, type StoreOptions } from './store.ts'
