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
- `src/db/` is the D1 store: `createD1Store(db, { clock? })` implements `ContentStore` over a
  `D1Database` or a D1 session, without a cast. A write is one `db.batch`: the revision or
  publication is inserted only while the entry is at `expectedVersion`, its tags only `WHERE
  EXISTS` their revision, and the entry is updated with the same predicate and `RETURNING`; an
  empty `RETURNING` is followed by one read that tells `conflict` from `not_found`
  (`tests/db/append-revision.workerd.test.ts` pins the SQL of the batch).
- Every statement of the store carries `site_id`, the follow-up reads included
  (`tests/db/isolation.workerd.test.ts` runs every method against two seeded sites).
- D1's limits are kept in code: at most 90 bound values per statement (`src/db/chunks.ts`),
  compound `SELECT`s of at most 5 terms (tags go in a `VALUES` list), and rows under
  `MAX_ROW_BYTES`, refused as `too_large` before they are written.
- Listings read summaries (the revision's id, frontmatter and tags) from an index of `entries`
  and sort nothing: the published view names the literal `'published'`, and the cursor is the
  row value `(sort key, id) < (?, ?)` (`tests/db/list-plans.workerd.test.ts` reads
  `EXPLAIN QUERY PLAN`).
- `tests/support/sites.ts` seeds a whole site with SQL, with the same natural keys every
  time; the tests that check one site cannot reach another seed two.
- `src/mcp/annotations.ts` maps each effect to its MCP hints, and `src/limits.ts` holds the output
  cap, the timeout and the store's limits under D1's.
- `src/auth` is what the gateway runs before the MCP endpoint, in this order:
  `checkHostAndOrigin` (fails closed: no valid `HOLLWARE_PUBLIC_URL` is a 500; another Host or
  Origin, port and scheme included, is a 403; `X-Forwarded-Host` counts for nothing),
  `readBearerToken`, then `checkPersonalToken` on the `D1Database` binding, never a replica
  session, so a revoked token stops at once. Hand its `touch` to `ctx.waitUntil`. A refused token
  gets one answer whether it was unknown, expired or revoked: log the reason, never send it.
  `ROLE_SCOPES` has one entry per role of the `users_role` check; owners get every scope, the
  other roles none until v0.3.
- `src/mcp` is the MCP adapter: `createMcpEndpoint` returns `{ fetch(request, call) }`, which
  the gateway mounts at `/mcp` once per isolate, passing `{ principal, requestId, context }`.
  It sets the view (`head`) and the client itself, asks for each tool's scopes before its
  handler, answers errors as `{ code, message, fix }` without structured content (clients check
  structured content against the output schema even with `isError`), and asks 2026 clients that
  declared form elicitation to acknowledge the warnings of `publish` (MRTR). Do not read or
  rewrite the body or the `Mcp-*` headers before it.
- `src` type-checks with the Workers runtime types that `wrangler types` generates for
  `wrangler.jsonc` (the test configuration, without Node.js), and nothing else.
- Tests that need workerd (D1, `cloudflare:*`) are `*.workerd.test.ts` and run in
  `server:workerd`, on a local D1 with `migrations/` applied; the rest run in Node.
