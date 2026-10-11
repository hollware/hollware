# Hollware implementation plan

> Temporary file. It tracks the roadmap from F0 to v1.0 and is deleted when v1.0 ships
> (together with its mention in `AGENTS.md`). The design lives in `docs/design.md`;
> decisions live in `docs/adr/`.

- **Status:** F0 in progress · **Started:** 2026-10-11
- **Legend:** `[ ]` todo · `[~]` in progress · `[x]` done and verified · `[!]` blocked
- **Cadence:** one stage at a time. Each stage ends with acceptance, reviewers, green CI,
  a clean-clone check and a pause for the maintainer's review.

## How work is done

- An orchestrator (Opus) writes shared interfaces, installs dependencies, dispatches work
  packages (WPs) to sub-agents (Sonnet), verifies empirically and commits to `main`
  (Conventional Commits, no trailers).
- Sub-agents own disjoint directories. Only the orchestrator edits root files: `package.json`,
  `pnpm-workspace.yaml`, `pnpm-lock.yaml`, `vite.config.ts` and (after F0) `.github/workflows/`.
- Sub-agents never install dependencies, never commit, read installed types/READMEs before
  using a library (Vite+ ships its guides in `node_modules/vite-plus/docs/guide/`), follow
  the test bar in `AGENTS.md`, and report **Evidence** (dated commands, output tails,
  mutations tried) and **Not verified** sections.
- Verification per WP: scope check (`git status`), the WP's commands re-run by the
  orchestrator, full `vp check` + `vp test`, security-sensitive code read, and at least one
  mutation with `scripts/break-line.ts` that must report `CAUGHT`.
- Stage start: stack check, the stage detailed here, then an adversarial review with
  severity ids (C1, H1, M1…) answered before dispatch.
- Stage end: `tests/acceptance/<stage>/` green, three read-only reviewers (structure,
  tests/evidence, security/product) whose findings are triaged Auto / Ask / Block, CI green,
  clean clone, summary to the maintainer.

---

## F0 — Foundations

**Goal:** a public repo that explains the thesis, with a walking skeleton of the stack
before the first feature.

### F0-0 Preparation (orchestrator)

- [x] `vp upgrade` → global `vp` 1.1.0
- [x] `vp create vite:monorepo --no-interactive --package-manager pnpm --directory hollware --git --hooks --no-agent --no-editor`; template samples removed
- [x] Pins: `.node-version` = 24.21.0; `packageManager` = `pnpm@12.11.2+sha512…` (hash from the registry); `engines.node >=24.11.0`
- [x] `pnpm-workspace.yaml`: globs `apps/* examples/* packages/* templates/*`, exact catalog (versions ≥ 24 h old; `vitest` 5.0.3 is the one vite-plus depends on), `minimumReleaseAge: 1440`, `trustPolicy: no-downgrade`, `allowBuilds` with reasons
- [x] Root `vite.config.ts`: strict lint (`no-floating-promises`, `no-misused-promises`, `no-explicit-any`, `node/no-process-env` in `packages/*/src`, no type assertions in tests — each rule verified to fire), `fmt` (no semicolons, single quotes), tasks `check:commit` / `check:push`
- [x] `.vite-hooks/pre-commit`: `vp staged` + `vp run check:commit`
- [x] `.claude/settings.local.json` (git-ignored): `ask` rules for deploy, `--remote`, publish/stage, trust
- [x] Skeleton manifests for the six packages, `apps/playground` and `templates/starter`; one install
- [ ] First local commit
- [ ] **Maintainer:** reserve the six npm names before the repo is public (placeholders `0.0.0`)
- [ ] `gh repo create hollware/hollware --public` and push
- [ ] Repo settings via `gh api`: private vulnerability reporting, secret scanning + push protection, CodeQL default setup, Dependabot alerts (no PRs), read-only workflow token that may create PRs, `main` ruleset (no force-push, no deletion), tag ruleset `*@*`, immutable releases, environment `npm` (only `main`, maintainer approval)

### Wave 1 (parallel)

- [ ] **F0-1 Governance** — owns root `*.md` except `AGENTS.md`/`PLAN.md`, `LICENSE`, `.github/ISSUE_TEMPLATE/`, `.github/pull_request_template.md`, `.github/CODEOWNERS`
  - `LICENSE` (MIT, "Copyright (c) 2026-present Sergio Azócar and Hollware contributors"), `README.md` (thesis, principles, status, roadmap), `CONTRIBUTING.md`, `CODE_OF_CONDUCT.md` (Contributor Covenant 2.1), `SECURITY.md` (GitHub private vulnerability reporting only)
- [ ] **F0-2 Design and ADRs** — owns `docs/`
  - `docs/design.md` (English adaptation of design v0.2, without the EmDash spike, with the execution decisions)
  - `docs/adr/0001…0014-*.md` (Status, Context, Decision, Consequences, Alternatives) + `docs/adr/README.md` (index, template). ADR-014 = release pipeline (Changesets + `pnpm stage publish`)
- [ ] **F0-3a Packages** — owns `packages/*`
  - Complete manifests (`exports`, `files`, `license`, `engines`, `repository {url, directory}`, `publishConfig {access, provenance}`), `src/index.ts`, `vite.config.ts` with `pack` (tsgo dts, exports), per-package `tsconfig.json`, `README.md`, `AGENTS.md`, a smoke test; `hollware` and `create-hollware` bins answer `--version` and `--help`
- [ ] **F0-3b Cloudflare walking skeleton** — owns `apps/playground`, `templates/starter`, `examples/`
  - Worker via `@cloudflare/vite-plugin`: `vp dev` serves `/health`; workerd test via `@cloudflare/vitest-plugin`
  - A named `WorkerEntrypoint` called by a second Worker over a service binding, tested with wrangler's `createTestHarness`
  - D1 with `migrations_dir` inside `node_modules`; `wrangler types`; one `wrangler check startup`; `wrangler deploy --dry-run` without an account
- [ ] **F0-4 CI and releases** — owns `.github/workflows/`, `.changeset/`, `.github/AGENTS.md`
  - `ci.yml`: `voidzero-dev/setup-vp@68f39c78aaf39be468cabd2afb09c162574c84af # v1.21.2`, `vp run check:push`, `wrangler types --check`, `publint`, changeset check (PR: against `origin/main`; push: `before..sha`), `pnpm exec pkg-pr-new publish --pnpm './packages/*'`
  - `security.yml`: dependency review (PRs), OpenSSF Scorecard, zizmor, weekly `pnpm audit --prod --audit-level=high`
  - `release.yml` (`changesets/action@ae32849d5ba541f9ae29e40e22a623bc13562f51 # v2.1.2`), `permissions: {}`, concurrency `release`, `if: github.repository == 'hollware/hollware'`: `select-mode` → `version` (Version Packages PR) → `pack` (tarballs as artifact) → `stage` (environment `npm`, `id-token: write`, no repo code, `pnpm stage publish <tgz> --provenance`) → maintainer approves with 2FA → `finalize` (wait until live, check `dist.attestations`, `changeset git-tag`, GitHub Releases). Release jobs use `setup-vp` with `cache: false`
  - `.changeset/config.json`: `fixed: [[six packages]]`, `access: public`, `privatePackages: {version: false, tag: false}`; version script `changeset version && pnpm install --lockfile-only`; spike: Changesets 3 on pnpm 12

### Wave 2

- [ ] **F0-5 Verification surface** — owns root `AGENTS.md`, `tests/`, `scripts/break-line.ts`
  - Root `AGENTS.md`: repo map, commands, conventions, the `PLAN.md` protocol, the dependency-update routine, "never create `CLAUDE.md`", the **test bar**, and the doctrine that `AGENTS.md` orients while rules live in tests, lint or types
  - `scripts/break-line.ts` + its tests (exact replace → run command → byte-identical restore → `CAUGHT` / `NOT CAUGHT` / `ERROR`)
  - Convention tests: manifest fields; no `CLAUDE.md`; `core` has no Cloudflare imports; every bare import is declared; every dependency uses `catalog:`; the `fixed` group equals the public packages; pnpm policy present and every `minimumReleaseAgeExclude` has a reason and an expiry; workflows (40-char SHA + `# vX.Y.Z`, `permissions: {}` at the top, `id-token: write` only in `release.yml` job `stage`, `persist-credentials: false`, no `NPM_TOKEN` / `npm publish` / `npx` / `dlx`); ADR headings
  - Meta-tests: backtick paths in `AGENTS.md`/`README.md` exist; `AGENTS.md` cites only real scripts and tasks; `AGENTS.md` ≤ 12,000 characters; every test file runs in a CI gate; exception lists may only shrink; every patch has a reason and a test; each guard has a self-test proving it can fail

### F0-6 First CI release (maintainer + orchestrator)

- [ ] **Maintainer:** install the pkg.pr.new GitHub App on the org
- [ ] **Maintainer:** right before the first release, `npm trust github <pkg> --file release.yml --repo hollware/hollware --env npm --allow-stage-publish` ×6 (2FA; expires if unused for 2 days)
- [ ] Ship `0.0.1` through CI: changeset → Version Packages PR → merge → `npm` environment click → 2FA approval → tags and releases

### F0-7 Close

- [ ] Acceptance, reviewers, clean clone, CI green, summary, pause

### Acceptance criteria

| #       | Criterion                   | Verification                                                                                                           |
| ------- | --------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| AC-F0-1 | Public repo with governance | `gh api repos/hollware/hollware --jq .visibility` → `public`; private vulnerability reporting enabled                  |
| AC-F0-2 | Design and 14 ADRs          | convention test (required headings)                                                                                    |
| AC-F0-3 | Clean clone works           | temp dir: `pnpm install --frozen-lockfile && vp run check:push` → exit 0                                               |
| AC-F0-4 | Walking skeleton            | `vp dev` + `curl /health` → 200; workerd test passes; harness RPC test passes; `wrangler deploy --dry-run` succeeds    |
| AC-F0-5 | Publishable packages        | `publint` clean; `pnpm pack` contains only `dist`, README, LICENSE, `package.json`                                     |
| AC-F0-6 | Guards bite                 | guards pass; deliberate violations (e.g. adding a `CLAUDE.md`) fail them                                               |
| AC-F0-7 | CI green on `main`          | `gh run list --branch main --json conclusion`                                                                          |
| AC-F0-8 | Single version              | a trial `changeset version` in a temp worktree bumps all six to the same version                                       |
| AC-F0-9 | Release pipeline proven     | `npm view @hollware/core@0.0.1 dist.attestations` shows provenance (all six); tags `*@0.0.1` and GitHub Releases exist |

### Verification log

- 2026-10-11 — F0-0: `vp --version` → 1.1.0; install passes supply-chain policies (199 entries); a probe file triggered `no-explicit-any`, `node/no-process-env`, `consistent-type-assertions` and `no-floating-promises`.

---

## v0.1 — Core

**Goal:** an agent writes and publishes over MCP with contracts validated at write time,
and an example site reads what was published over RPC.

### Spikes (orchestrator, before dispatch)

- [ ] S1 Hono 5 RC under `vp dev` and workerd (fallback: Hono 4.13.13; version-specific code isolated in `http/errors.ts`)
- [ ] S2 MCP SDK 2.3.1 in workerd, both eras; CPU of the per-request factory + Zod→JSON Schema (fallback: precomputed schemas via `fromJsonSchema`)
- [ ] S3 Comark + `@comark/html` in workerd; bundle size (fallback: `nodejs_compat`)
- [ ] S4 `withSession` in Miniflare; drizzle with a session; `INSERT…SELECT` + `UPDATE…RETURNING` in one batch (fallback: plain `env.DB` / raw `env.DB.batch`)
- [ ] S5 SimpleWebAuthn 14 + a soft authenticator in workerd (fallback: `nodejs_compat`)
- [ ] S6 `createTestHarness` with Vite output, named entrypoint, `applyD1Migrations` from `node_modules`
- [ ] S7 `wrangler check startup` on built output → calibrate budgets
- [ ] S8 MCP conformance 0.2.0-alpha against a stub Worker → size the baseline
- [ ] S9 do `vp dev` and `wrangler d1 execute --local` share state?

### Wave 0 (orchestrator): shared interfaces that compile before parallel work

- [ ] `packages/core/src/config/types.ts` — `defineConfig`, `defineCollection`, `defineComponent`, `defineContract`; collection = `schema` (Standard Schema + JSON Schema), per-locale routes, `translations.groupBy`, `components`, `contracts`, `maxMarkdownBytes`
- [ ] `packages/core/src/markdown/types.ts` — `processMarkdown()` → frontmatter, document, extracted (headings, classified links, images, components, words), `comarkVersion`; `renderHtml()`
- [ ] `packages/core/src/contracts/types.ts` — `Violation {contract, severity, path (JSON Pointer), message, fix, line?}`, `Verdict`, `Contract`, `EntryLookup` port
- [ ] `packages/core/src/operations/` — nine specs (`describe_site`, `list_entries`, `get_entry`, `get_translations`, `create_draft`, `update_draft`, `validate`, `publish`, `unpublish`) with Zod input/output, scopes, `effect`, annotations; flat outputs `{outcome, entry?, verdict?, conflict?}`
- [ ] `packages/server/src/{ports.ts, db/schema.ts, db/columns.ts, index.ts}` — `createHollware(config) → {fetch, Hollware}`
- [ ] Synthetic fixtures: `tests/fixtures/content/**`, `tests/fixtures/documents/*.json`, a bilingual blog config in `apps/playground/hollware.config.ts`
- [ ] Stage dependencies in the catalog (≥ 24 h old)

### Data model and rules

- `columns.ts`: `id(prefix)` (prefixed ULIDs: `ent_`, `rev_`, `usr_`, `tok_`…), UTC `created_at`/`updated_at` with `$onUpdate`; every table uses it and only repository functions write
- `site_id` on every table including children, `UNIQUE(id, site_id)` + composite FKs, coherence CHECKs; schema guard test via `getTableConfig` (shrink-only exceptions; user FKs classified); CI: `drizzle-kit generate` yields no diff
- `entries`: `published_at`, `published_sort_key`, `UNIQUE(site_id, collection, translation_group, locale)`, partial index for published listings; `version` increments on every mutation
- `revisions`: full file Markdown (byte-identical export); triggers block `DELETE` and updates of immutable columns; derived columns updatable by `reparse`; `revision_tags`
- Auth tables: `users`, `passkeys`, `tokens` (hash, scopes, expiry, revocation, last use), `setup_links` (single use via atomic `UPDATE … RETURNING`), `auth_challenges`
- Optimistic write = one `db.batch`: `INSERT INTO revisions … SELECT … WHERE version = ?` + `UPDATE entries … WHERE version = ? RETURNING version`; empty `RETURNING` = conflict; rows over 1.9 MB = `size-limit` violation
- Reads: MCP on the primary; RPC through `withSession('first-unconstrained')` via one `readDb()`
- Publish re-runs contracts in phase `publish` → `blocked` on errors; `needs_acknowledgement` on unacknowledged warnings (MRTR when the client declares elicitation)
- Auth: workers-oauth-provider 1.2.3 authorization + resource servers in one Worker; `validateToken` routes `hw_pat_…` to D1; effective scopes = token ∩ current role; 403 `insufficient_scope` step-up; CIMD with `global_fetch_strictly_public`; issuer from `HOLLWARE_PUBLIC_URL`; Host/Origin guards in front of MCP
- `tools/list` identical for everyone, sorted and cacheable; scopes checked at call time; `HollwareError {code, message, fix, internal cause}`; each operation declares `effect` → MCP annotations, output cap, timeout, one log line with `requestId`
- RPC `Hollware` is read-only: `getEntry`, `listEntries`, `getTranslations`, `describeSite`
- CLI never loads `hollware.config.ts`: `init`, `migrate` (`--check`, backup before `--remote`), `token create|list|revoke` run SQL through the project's `wrangler d1`; `import` talks MCP with a personal token in two phases and is idempotent

### Waves

- [ ] Wave 1: WP1 config (`core/src/{config,schema}`) · WP2 Markdown/Comark (`core/src/markdown`, bench) · WP3 contracts (`core/src/contracts`) · WP4 D1 + Store (`server/src/db`, `server/migrations`) · WP5 auth (`server/src/auth`) · WP6 CLI (`packages/cli`)
- [ ] Wave 2: WP7 operation handlers (`server/src/ops`) · WP8 MCP adapter (`server/src/mcp`) · WP12a acceptance suite written first (`tests/acceptance/v0.1`)
- [ ] Wave 3: WP9 Hono composition + RPC (`server/src/{http,rpc}`) · WP10 conformance (`tests/conformance`) · WP11 playground, starter, `examples/worker-site`, budgets (`scripts/check-budgets.ts`)
- [ ] Wave 4: acceptance green (fixes return to the owning WP), reviewers, close

### Acceptance criteria (`tests/acceptance/v0.1/`, via `createTestHarness`, the built playground and `examples/worker-site`)

| #         | Criterion               | Verification                                                                                                                                                                                                                                        |
| --------- | ----------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| AC-0.1-1  | Static checks and build | `vp check && vp run -r build && vp run -r publint && vp run types:check`                                                                                                                                                                            |
| AC-0.1-2  | Unit and integration    | `vp test`                                                                                                                                                                                                                                           |
| AC-0.1-3  | Agent flow (2026-07-28) | `vp run test:acceptance -- agent-flow`: describe_site → invalid draft saved with fixes → publish blocked → fixed update v2 → stale v1 conflict (no new revision) → validate keeps version → publish with warnings via MRTR or `acknowledgeWarnings` |
| AC-0.1-4  | 2025 clients            | initialize → tools/list → get_entry                                                                                                                                                                                                                 |
| AC-0.1-5  | RPC from another Worker | published HTML served, drafts 404, `listEntries` with tag + cursor, `getTranslations` ES/EN pair                                                                                                                                                    |
| AC-0.1-6  | Auth                    | 401 with `resource_metadata`; metadata endpoints; OAuth with the soft passkey; `content:read` token → 403 naming missing scopes; personal token valid/expired/revoked; setup link single use                                                        |
| AC-0.1-7  | MCP conformance         | `vp run test:conformance` with `--requirements 2026-07-28` and `2025-11-25` → exit 0                                                                                                                                                                |
| AC-0.1-8  | Budgets                 | `vp run check:budgets` vs `budgets.json` (S7 + 15 %); raising it needs an ADR note                                                                                                                                                                  |
| AC-0.1-9  | Import                  | synthetic corpus: 10 entries, 5 groups, tags; a second run creates 0 revisions                                                                                                                                                                      |
| AC-0.1-10 | Migrations              | fresh migrate; re-run is a no-op; `migrate --check`; lock test                                                                                                                                                                                      |
| AC-0.1-11 | Clean clone             | clone + `vp install --frozen-lockfile && vp check && vp test && vp run test:acceptance`                                                                                                                                                             |
| AC-0.1-12 | Tests can fail          | `break-line` on the version predicate, scope gate, publish gate, DNS guard and RPC read-only filter turns each matching AC red                                                                                                                      |
| AC-0.1-13 | Release 0.1.0           | published through the pipeline with provenance, approved by the maintainer                                                                                                                                                                          |

New ADRs: 015 operation/outcome shapes · 016 auth topology · 017 append-only revisions with derived columns · 018 conformance baseline policy · 019 fix-forward migrations.

---

## Later stages (detailed at the start of each stage)

- **v0.2 Publishing** — publish Workflow tracked as an MCP Task + scheduling; outbox → Queue → HMAC webhooks, IndexNow, custom subscribers, DLQ; revision diff, restore and trash (`delete_entry`/`restore_entry`); media in R2 + Images; FTS5 search; HTTP API + OpenAPI 3.1 + ETag + Workers Cache + purge; `@hollware/client` (binding or HTTP); `export`, `reparse`, `reindex`, cron backups; `audit_log`; optional write-time highlighting. **Exit:** on the demo (`demo.hollware.com`), publish over MCP is live in < 60 s with no CI.
- **v0.3 Admin** — Vue 3.5 + Nuxt UI 4 + Vue Router 5 SPA shipped in `@hollware/admin`; PKCE first-party client; editor (CodeMirror 6 + Comark preview), contract-driven forms, review queue with diff, approval via Workflow `waitForEvent`; identity screens. **Exit:** an agent's post approved from the admin; axe clean.
- **v0.4 Distribution** — `create-hollware` + starter + `hollware deploy`/`doctor`; read tokens and site isolation; Docus docs on hollware.com written in Hollware; `@hollware/nuxt`. **Exit:** a docs-only sub-agent and an external person install Hollware from the docs.
- **v0.5 Intelligence** — embeddings (Workers AI + Vectorize), semantic/hybrid search, related entries, Analytics Engine + `content_stats`, `@hollware/agents` (Agents SDK, never `content:publish`). **Exit:** an agent picks what to update from metrics and publishes it through the contracts.
- **v1.0 Stable** — stability ADR, API guards (oasdiff, api-extractor, publint, attw, migrations lock), `cf`/Drizzle v1 if GA, importers, security review, `@hollware/astro`, `@hollware/next`. **Exit:** hollware.com + the demo + at least one external site in production; this file is deleted.

Out of scope for this plan: migrating sergioazocar.com. It happens after v1.0 with its own plan in that repository.
