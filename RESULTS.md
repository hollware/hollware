# v0.1 spike results (orchestrator notes, 2026-10-12)

## S4 — D1 + drizzle-orm 0.45.4 (clone spikes/d1, apps/spike-d1) — VERIFIED

Orchestrator re-run: `WRANGLER_SEND_METRICS=false ./node_modules/.bin/vp test --project 'spike-d1:*'` → 10 files, 76 tests pass.
Orchestrator mutations (break-line, baseline first):
- drop `eq(entries.version, write.expectedVersion)` in src/optimistic-write.ts → CAUGHT by s4b (stale version, replay, SQL shape) and s4c (2 and 8 racers).
- trigger `revisions_no_replace` `WHEN 0` → CAUGHT by s4d (plain INSERT, INSERT OR REPLACE, upsert on a taken id).

Findings for the plan:
- Optimistic write with drizzle: `db.insert(revisions).select(qb => ...)` + `db.update(entries).set({version: sql`+1`}).where(...).returning(...)` in one `db.batch`, INSERT first. Select must list every column in table order; computed values need `.as()`. Raw `env.DB.batch` twin passes the same tests. Keep a SQL-shape canary test (drizzle's logger does not log batch statements).
- Empty RETURNING does not tell `not_found` from `conflict`: one extra read after an empty RETURNING.
- `db.transaction()` fails on D1 (BEGIN not allowed): batch is the only atomic primitive. Errors inside `db.batch` arrive unwrapped; single statements arrive as DrizzleQueryError with the D1 error as `cause`.
- Concurrency: Promise.all of 2 and 8 batches → exactly one winner, one revision (local: each batch is a DO SQLite transaction). Control without batch inserts 8 revisions, so the test discriminates.
- Triggers: three, not two — BEFORE DELETE, BEFORE UPDATE OF immutable columns, and BEFORE INSERT WHEN the id exists (INSERT OR REPLACE skips DELETE triggers since recursive_triggers is off). Messages: `D1_ERROR: revisions are append-only: …: SQLITE_CONSTRAINT (extended: SQLITE_CONSTRAINT_TRIGGER)`; classify on our own prefix. A trigger abort rolls back the whole batch.
- drizzle-kit never drops triggers on `generate` (snapshots do not model them), but a migration that REBUILDS `revisions` (__new_ table + DROP + RENAME) silently drops them → guard: exact trigger list in sqlite_master after all migrations; rebuilds of `revisions` and of `entries` (FK failure, `PRAGMA foreign_keys=OFF` is a no-op inside the migration transaction) are hand-written migrations.
- Sessions: `withSession('first-unconstrained')` works locally; local bookmark is a synthetic counter and Miniflare ignores incoming bookmarks (no replica semantics locally). drizzle runs on a session at runtime but not in types (TS2739: missing exec/withSession/dump) → a typed adapter `sessionAsDatabase` without casts.
- Sizes: Miniflare does NOT enforce D1's 2 MB row limit (local ceiling ~8 MiB per row, `D1_ERROR: string or blob too big: SQLITE_TOOBIG`). The `size-limit` rule must count UTF-8 bytes itself before D1. Miniflare does enforce 100 bound parameters per statement and 100,000-byte statements → bind the Markdown, chunk multi-row inserts.
- drizzle-kit `migrations/meta/*.json` fails oxfmt → `fmt.ignorePatterns`. `out` must be relative to the cwd.
- Worker with drizzle: dry-run 177.44 KiB / gzip 34.26 KiB, no `node:` imports, no nodejs_compat.
- Not verified: production limits/messages, real replicas, drizzle-kit push, Drizzle v1.
- Telemetry: the agent ran wrangler with default telemetry until 15:16:29; all agents told to set WRANGLER_SEND_METRICS=false afterwards.

## Decision 3 research — core's type environment (clone d3-exp) — 2026-10-12

- Probe in core/src using TextEncoder, URL, crypto.subtle, structuredClone (needed) and setImmediate, global (Node-only), document, window, localStorage (browser-only).
- Today (`types: ["node"]`, program = src + tests + vite.config.ts): Node-only globals pass; only document/window fail.
- `types: []` in the same program changes nothing: tests and vite.config.ts import vite-plus, whose types pull Node types in transitively.
- src-only program, `types: []`, lib es2024: everything fails, the needed web APIs included.
- src-only program, `types: []`, lib ["es2024", "webworker"]: needed web APIs pass; setImmediate, global, document, window, localStorage fail. (dom instead of webworker lets localStorage/window through.)
- Layout tried: packages/core/tsconfig.json = src only, lib es2024+webworker, types []; packages/core/tests/tsconfig.json = node types, includes tests + the package's vite configs. `vp check` passes clean; a `typeof setImmediate` in core/src fails `vp check` with TS2304 (so CI enforces it).
- Same core tests in Node (project @hollware/core) and in workerd (vitest.workerd.config.ts with cloudflareTest({ miniflare: { compatibilityDate } }), no Worker of its own, `vite-plus/test` imports work): 2 files / 4 tests pass in both; a test asserts navigator.userAgent is Node.js or Cloudflare-Workers.

## Cross-cutting — Node.js compatibility is ON by default (verified by the orchestrator, 2026-10-12)

- wrangler 4.149.0 `isNodejsCompatDefaultOn`: compatibility dates >= 2026-08-04 turn nodejs_compat and nodejs_compat_v2 on (Cloudflare docs agree; opt out with BOTH `no_nodejs_compat` and `no_nodejs_compat_v2`).
- Real workerd (`wrangler dev`) probe: date 2026-10-06, no flags → process object, Buffer function, setImmediate function. With both opt-outs → all undefined. Date 2026-08-03 → all undefined.
- @cloudflare/vitest-plugin 1.4.0 always enables nodejs_compat_v2 for the runner Worker (pool/index.mjs ~69558): a workerd test can never prove "works without Node". Only the BUILT Worker under real workerd with the opt-outs can.
- Today apps/playground and templates/starter (date 2026-10-06, no flags) run WITH Node. ADR-005's "no Node compatibility flag" is only true with the opt-outs.
- The three running spikes (hono-mcp, comark, auth) were told to add the opt-outs and prove "no Node" on the built Worker.

## OAuth — workers-oauth-provider 1.2.3 + Hono 5 RC (clone spikes/oauth) — VERIFIED

Orchestrator re-run: 10 files, 104 tests pass (projects spike-oauth:workerd, :roles, :noflag). Hook names checked in dist/oauth-provider.d.ts (validateToken = OAuthResourceServer / OAuthAuthorizationServer; resolveExternalToken = OAuthProvider), constructor TypeError text checked in dist/oauth-provider.js:2786, CIMD flag requirement at :2452/:4702.
Orchestrator mutation: personal token expiry check disabled → CAUGHT by the expired-token tests of both topologies.

Findings for the plan:
- Use the role-based API: `OAuthAuthorizationServer` + one `OAuthResourceServer` per surface (`${url}/mcp`, `${url}/v1`). The combined `OAuthProvider` allows ONE resource (a second prefix throws), rejects the MCP endpoint URL as `resource` when the resource is the origin, and gives `ctx.auth` without scope/userId/clientId for external tokens. Roles: `validateToken(env, request) => (resource, token)` handles PATs (D1) and OAuth (AS) in one place, effective scopes = token ∩ current role, tokens bound to their resource.
- Issuer/resource from `HOLLWARE_PUBLIC_URL` (roles: explicit `issuer`; combined only with absolute endpoint URLs, otherwise the issuer follows the Host header).
- Host/Origin guard must wrap the provider: it answers CORS preflights itself and reflects any Origin; combined `/authorize` answers on any host.
- Route before Hono and pass the real ExecutionContext: Hono 5's `c.executionCtx` type lacks tracing/abort/exports (TS2769). In Hono 5, onError/notFound are middleware.
- Scopes are not enforced by the provider (`requiredScopes` is only advertised): `/authorize` grants requested ∩ catalog ∩ role via `completeAuthorization({ scope })`; handlers read `ctx.auth.scope` (a client can narrow on refresh; props keep the grant); 403 via `insufficientScope(ctx.auth, needed)`.
- Token format `userId:grantId:secret`: user ids travel in clear and cannot contain `:`. Refresh rotation keeps the old refresh token valid until the new one is used; no reuse detection. Redeeming a code twice revokes the grant.
- KV writes (measured in Miniflare): sign-up 4 puts + 1 list; refresh 2 puts; API call with OAuth 1 get; with PAT 0. With 1 h access tokens an always-on client costs ~48 puts/day → the Free plan's 1,000 writes/day covers ~20 clients. ADR-005's "KV Free is enough" needs a TTL decision.
- CIMD needs `clientIdMetadataDocumentEnabled` + `global_fetch_strictly_public`. That flag only makes global fetch behave as public-Internet traffic for the Worker's own zone (Cloudflare docs); it does NOT block private addresses, and the provider filters nothing (local workerd reached 127.0.0.1). Filter outside if "public only" is a requirement; redirects are followed; up to 3 fetches per sign-up without Cache-Control.
- Sizes: provider + Hono 5 + spike code: unminified 297 KiB / 76 KiB gz; minified 136 KiB / 38.6 KiB gz. `wrangler check startup`: ~11 ms window, 0 ms active (2 samples).
- Not verified: real MCP clients' `resource` values, production KV consistency/quotas, real consent screen, D1-backed PATs.
- Telemetry: the agent ran wrangler without WRANGLER_SEND_METRICS until 18:22Z.

## S1/S2/S8 — Hono 5 RC + MCP SDK 2.3.1 + conformance (clone spikes/hono-mcp) — VERIFIED

Orchestrator: 87 passed | 13 skipped (the skipped run against a built Worker); built Worker with both opt-outs under `wrangler dev` → /__runtime process "undefined", MCP tools/call 200, `spike-hono-mcp:node http` 6/6 against it. SDK claims checked in dist: `createMcpHandler(factory, options?)`, `cacheHints`, tools/list iterates registration order (mcp-*.mjs:1761). Mutations → CAUGHT: Host guard bypassed (mcp-guard tests), error handler falling back to text 500 (hono test).
- Hono 5 rc.1: keep. onError/notFound became middleware (`(c, next)`, error in `c.error`); a Hono-4-style `(err, c)` handler silently yields a plain-text 500. Removed: app.mount/fire, c.req.routePath/matchedRoutes, adapter subpaths (hono/cloudflare-workers…). ESM only, engines >=22.12. Same Worker −26% vs 4.13.13. Version-specific code fits in http/errors.ts.
- MCP: `createMcpHandler(factory)` mounted with `app.all('/mcp', c => mcp.fetch(c.req.raw, { authInfo }))`; factory runs per request. Set `capabilities.tools.listChanged: false`. Host/Origin: SDK helpers `hostHeaderValidationResponse` / `originValidationResponse` in front — spike guard only active when ALLOWED_HOSTS is set → Hollware's must fail closed. 2026 era needs Mcp-Method/Mcp-Name headers matching the body (a header-rewriting gateway breaks it). `requireScopes` scope challenge → 403 with WWW-Authenticate, but a request without authInfo passes: the gateway must 401.
- Validation in workerd: `validators/cf-worker` chosen by the `workerd` export condition; Ajv throws EvalError in real workerd. Invalid input → `isError: true` result (HTTP 200).
- tools/list byte-identical across calls/instances/runtimes, but NOT sorted (registration order) → sort in the registry. `cacheHints['tools/list'] = { ttlMs, cacheScope }`, only in 2026 results.
- CPU (Node 24): per-request server build 1.8 µs; a plan-sized registry (9 tools × 12 fields) costs ~1.4 ms per tools/list (Zod→JSON Schema conversion every request, since the SDK memo is per instance) → memoize the converted schemas per isolate (src/mcp/memoize.ts, ~25 lines, byte-identical output) → 0.14 ms. `fromJsonSchema` precomputed works but loses Zod defaults and error messages.
- Size: Hono + MCP + zod Worker 793 KB raw / 186 KB gz (minified 329 / 87 KB gz); SDK 62%, zod 32%. `wrangler check startup` Active ~20 ms (preloadSchemas ~5.6 ms + Zod init ~13 ms).
- MRTR: works in the 2026 era; impossible on the 2025 stateless fallback (no server-to-client requests) → `acknowledgeWarnings` is required for 2025 clients. Progress notifications stream in both eras.
- Conformance 0.2.0-alpha.12: `conformance server --url --requirements <rev> [--expected-failures f.yml] [-o dir]`. Stub: 2026 = 99 ok / 70 failed checks (5 clean scenarios of 37 required), 2025 = 35 / 26. All failures are unimplemented capabilities (resources, prompts, completion, logging) or missing `test_*` fixture tools; 0 wire-schema failures. Baselines 32 + 26 entries (one file per revision; a WARNING counts as a failure in baseline mode). Run against `wrangler dev` of the build: under `vp dev`, Vite's host check hides a missing DNS-rebinding guard.

## S3 — Comark 0.7.0 (clone spikes/comark) — VERIFIED

Orchestrator: 210 tests pass; probe confirms raw `<script>` passes through by default, heading slug drops non-ASCII (`Diseño` → `diseo`), autoClose default → RangeError on 5,000 `*a `, autoClose:false fine. Mutation: safe parser with default plugins → CAUGHT by the built-Worker safety tests.
- Works in workerd with Node off (built Worker, both opt-outs; `/runtime` process undefined). Bundle has no `node:` imports.
- Safety: by default raw HTML and props pass unescaped; disabling the html plugin is not enough (component syntax creates any tag, attribute syntax any attribute). Recipe: `registerDefaultPlugins:false` + chosen plugins + `security({ allowedTags: [...] })` (must list every allowed tag). `[x](javascript:…)` is left as text.
- autoClose (default on, for streaming) rewrites incomplete syntax silently and is quadratic/stack-overflowing on hostile input → `autoClose:false` for writes.
- Heading ids ASCII-only → generate our own ids (Spanish content) or `{#id}`. `&` not escaped in text/code (content fidelity bug for HTML posts). Link reference definitions leave `<component></component>`. Empty alt indistinguishable from missing alt.
- Comark rarely throws: only YAMLException and RangeError → the `comark-parse` contract needs its own checks (BOM, maxMarkdownBytes, leftovers like `comark:incomplete-*`).
- CPU (Node 24): warm 0.31 ms parse / 0.50 ms parse+render (2,000 words); 1.5 / 2.4 ms (10,000). COLD (new isolate): full write path ~10 ms for 2,000 words, ~19 ms for 10,000 → at/over the Free plan's 10 ms. Stored JSON document 1.29× the Markdown; render from stored JSON 2.4× cheaper than parsing.
- Size: parse+render Worker 572 KB / 159 KB gz (minified 287 / 110 KB gz); render-only (sites) 73 KB / 31.5 KB gz minified. Startup Active ~8.8 ms. Two copies of `entities`, full js-yaml and htmlparser2 always bundled. No runtime version export → pin with a test.

## S5 — SimpleWebAuthn 14.0.3 (clone spikes/auth) — VERIFIED

Orchestrator: 61 tests pass; library code confirms the module-level `defaultAuthenticatorSelection` that generateRegistrationOptions mutates (cross-request leak), optional `expectedRPID` in registration, verifyOKP importing the helpers barrel. Mutation: ECDSA signature sent raw instead of DER → CAUGHT by the Worker ceremony tests.
- Full ceremony passes on the built Worker in workerd with Node off (both opt-outs; `/selftest` process undefined, `node:crypto` not importable). Bundle identical with and without nodejs_compat.
- A tampered signature returns `verified: false` (does not throw); check `verified` always. Pass `expectedRPID` and `expectedOrigin` from config; fix `supportedAlgorithmIDs` (runtime-dependent defaults); new `authenticatorSelection` object per call; `expectedChallenge` as a function backed by D1 (TTL, purpose, single use); map errors to our own codes (messages are unreliable). Store `credentialDeviceType`, `credentialBackedUp`, `aaguid` (missing from the design's passkeys table); synced passkeys report counter 0.
- CPU: verify registration 0.031 ms, authentication 0.099 ms (Node); cold first call ~1 ms.
- Size: 617 KB / 125 KB gz unminified, 287 / 78 KB gz minified; >70% is X.509/attestation machinery unused with attestation 'none' → alias stubs cut it to 280 / 58 KB (35 KB minified) and still pass. ADR-005's "OAuth + SimpleWebAuthn = 115 KB gz" only holds minified (~111 KB); unminified ~175 KB gz.
- The software authenticator (ES256/EdDSA/RS256, 'none', flags, counters) is solid enough to become the auth WP's test authenticator.

## S7 inputs (budgets) — from the spikes, not calibrated yet
- Workers builds by @cloudflare/vite-plugin are NOT minified by default (sizes ~2× the minified ones). `wrangler check startup -c` ignores -c and follows `.wrangler/deploy/config.json`; use `wrangler deploy --dry-run --outfile X` + `check startup --workerBundle X`.
- Startup Active: Hono only ~0; Comark ~8.8 ms; SimpleWebAuthn ~10 ms; MCP SDK + zod ~20 ms; OAuth provider ~0. Combined server will be well above any single one.
