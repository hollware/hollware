# @hollware/server

The Hollware Worker: one handler per operation spec of `packages/core`, and the adapters that
serve them (ADR-017). Boundary rules for this package:

- It owns the D1 migrations in `migrations/` and ships them (`files` in `package.json`).
- A shipped migration is never edited or removed: fix forward with a new migration (ADR-023).
  The guard `shipped-migrations` compares `migrations/` with every `@hollware/server@*` tag.
- `src/db/schema.ts` is the schema. To change it, edit it and run
  `pnpm exec drizzle-kit generate --name <what>` here (`drizzle.config.ts`), then commit the SQL
  and its snapshot in `migrations/meta`. `tests/migrations.test.ts` fails while the schema has a
  change without its migration.
- What drizzle-kit does not model (triggers) and every table rebuild go in a hand-written
  migration, `drizzle-kit generate --custom --name <what>`, opening with a comment that says why.
- `revisions`, `revision_tags` and `publications` are append-only (ADR-021), through the triggers
  of `migrations/0002_append_only.sql`. A migration that rebuilds one of them creates its
  triggers again. A new column of them goes in its `_immutable` trigger or is listed as derived
  in `tests/append-only.workerd.test.ts`, and a new unique key goes in its `_no_replace` trigger.
- Never read `process.env`: configuration and bindings arrive as arguments.
- `src/ports.ts` is what the handlers need (`ContentStore`, `Clock`). Handlers (`src/ops`)
  import it and never `src/db`, so their tests run on fakes. `src/ops/types.ts` pairs one handler
  with each spec of `@hollware/core`, by type.
- Every method of the store takes the site first, and reads and writes only that site's rows.
- `tests/support/sites.ts` seeds a whole site with SQL, with the same natural keys every
  time; the tests that check one site cannot reach another seed two.
- `src/mcp/annotations.ts` maps each effect to its MCP hints, and `src/limits.ts` holds the output
  cap, the timeout and the store's limits under D1's.
- `src` type-checks with the Workers runtime types that `wrangler types` generates for
  `wrangler.jsonc` (the test configuration, without Node.js), and nothing else.
- Tests that need workerd (D1, `cloudflare:*`) are `*.workerd.test.ts` and run in
  `server:workerd`, on a local D1 with `migrations/` applied; the rest run in Node.
