# @hollware/server

The Hollware Worker: one handler per operation spec of `packages/core`, and the adapters that
serve them (ADR-017). Boundary rules for this package:

- It owns the D1 migrations in `migrations/` and ships them (`files` in `package.json`).
- A shipped migration is never edited: fix forward with a new migration.
- Never read `process.env`: configuration and bindings arrive as arguments.
- `src` type-checks with the Workers runtime types that `wrangler types` generates for
  `wrangler.jsonc` (the test configuration, without Node.js), and nothing else.
- Tests that need workerd (D1, `cloudflare:*`) are `*.workerd.test.ts` and run in
  `server:workerd`, on a local D1 with `migrations/` applied; the rest run in Node.
