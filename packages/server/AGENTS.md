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
  import it and never `src/db`, so an adapter can hand them any store; their tests run on D1.
  `src/ops/types.ts` pairs one handler with each spec of `@hollware/core`, by type.
- `src/ops` has one module per operation and exports `handlers`. A handler imports the ports,
  `@hollware/core` and its siblings, never `src/db`, `src/mcp` or a `cloudflare:` module
  (`tests/ops/boundary.test.ts`). Adapters parse the input with the spec's schema, check the
  scopes and build the context; every store call takes `context.site.key` and every read
  `context.view` (`tests/ops/isolation.workerd.test.ts`).
- A draft is saved whatever its contracts say. Only a file the pipeline cannot store, a slug or
  translation group another entry holds, and a row over D1's limit are `refused`, with
  `contractsHash: ''`. `update_draft` and `publish` check the version first; `unchanged` writes
  nothing. `publish` runs the pipeline and the contracts again in the publish phase, blocks on
  errors, asks for every warning by contract and path, and records them
  (`tests/ops/publishing.workerd.test.ts`, `tests/ops/flow.workerd.test.ts`).
- `createHollware(config)` in `src/index.ts` is `createHollwareWith(config, handlers)`. The entry
  imports `cloudflare:workers`, so whatever imports it runs in workerd
  (`tests/index.workerd.test.ts`).
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
  cap, the timeouts (10 s, and 30 s for the open-world tools of the same file) and the store's
  limits under D1's.
- `src/auth` is what the gateway runs before the MCP endpoint, in this order:
  `checkHostAndOrigin` (fails closed: no valid `HOLLWARE_PUBLIC_URL` is a 500; another Host or
  Origin, port and scheme included, is a 403; `X-Forwarded-Host` counts for nothing),
  `readBearerToken`, then `checkPersonalToken` on the `D1Database` binding, never a replica
  session, so a revoked token stops at once. Hand its `touch` to `ctx.waitUntil`. A refused token
  gets one answer whether it was unknown, expired or revoked: log the reason, never send it.
  `ROLE_SCOPES` has one entry per role of the `users_role` check: owner, editor, author.
- `src/oauth` is the OAuth server of ADR-026, built once per public URL: an
  `OAuthAuthorizationServer` and an `OAuthResourceServer` each for `/mcp` and `/v1`. The resource
  server validates a token by its shape: `hw_pat_…` goes to `checkPersonalToken`, anything else to
  the authorization server, and either way the scopes are intersected with the user's role at that
  request. `/authorize` is ours (`authorize.ts`): the session cookie, then a consent page that
  offers only what the role allows. A validator never throws to the library, which would answer a
  bare 503: it hands the error to the gateway, which throws it into the error handler.
- Reviews (v0.3): `publish` from a principal without `content:publish` runs the same checks and
  asks for a review (`src/db/reviews.ts`) instead of publishing. A write that moves the entry
  closes its pending review in the same batch: a new revision cancels it, a publication approves
  it. `approve_review` publishes through the `publish` handler itself, in the approver's name.
- The trash of entries: `delete_entry` sets `entries.deleted_at` on a draft, and every read of the
  store (the contracts' lookups included) leaves a trashed entry out but `listEntries` with
  `trashed`; it keeps its slug and translation, so `create_draft` answers `in_trash`
  (`tests/ops/trash.workerd.test.ts`).
- `src/identity` is the passkeys, the invitations and the sessions: the pages `/setup` and
  `/signin`, the four steps of their ceremonies, and `POST /authorize/signout`, below the one path
  the session cookie is sent to. A person manages their own passkeys, grants and sessions over
  `/v1/admin/account`; their last passkey is refused in the statement that deletes.
- `src/compose.ts`: `createHollwareWith(config, handlers, { clock? })` builds the Worker once,
  when the user's module loads: it resolves the config (a broken one throws its `ConfigError`
  there), builds the MCP endpoint, the gateway and the `Hollware` class. Every log line is one
  JSON line through `console.log`.
- `src/http` is the gateway, a Hono 5 app: a request id, then `checkHostAndOrigin` before every
  route, then `GET /health`, `/mcp` and `/v1` behind their resource servers (401 with the
  protected resource metadata before the endpoint, `touch` to `ctx.waitUntil`, a store on the
  primary), the authorization server's routes, the identity pages and a JSON 404. Whatever a route throws is a JSON 500 with the request id in its
  fix; a D1 failure is never a 401. Hono 5's `onError` and `notFound` are middleware `(c, next)`;
  the Hono 4 form answers a plain-text 500, so everything version-specific stays in
  `src/http/errors.ts`.
- `src/rpc` is what sites call over a service binding: the class has the six methods of
  `HollwareRpc` and nothing else, because everything on its prototype is callable. Each call checks
  its site, parses its input with the spec, and runs on the published view with a binding
  principal and a replica session. An error crosses a binding with its `cause`, so a failure
  reaches the caller rebuilt without it, or as `internal`, and the cause goes to the log.
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
