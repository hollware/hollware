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
- [x] Root `vite.config.ts`: strict lint (each rule verified to fire), `fmt` (no semicolons, single quotes, generated files ignored), lint override for `*.workerd.test.ts`, `test.projects` (packages, worker test configs, a `repo` project for `scripts/` and `tests/`), tasks `check:commit` / `check:push` (check → test → build → publint → types)
- [x] `tsconfig.base.json` (strict, `erasableSyntaxOnly`) and a root `tsconfig.json` for `scripts/` and `tests/`
- [x] `.vite-hooks/pre-commit`: `vp staged` + `vp run check:commit`
- [x] `.claude/settings.local.json` (git-ignored): `ask` rules for deploy, `--remote`, publish/stage, trust
- [x] Skeleton manifests for the six packages, `apps/playground` (depends on `@hollware/server`) and `templates/starter`; `publint` and `types:check` scripts; `packages/server/migrations/0000_init.sql` shipped through `files`; one install
- [x] `scripts/break-line.ts` + 8 tests (moved here from F0-5, review H2); two self-mutations reported `CAUGHT`
- [x] Root `AGENTS.md` with the test bar (moved here from F0-5, review H2)
- [x] First local commit
- [x] Repo-local git identity uses the GitHub noreply address (`6147546+sergioazoc@users.noreply.github.com`); the local commits were re-authored before the first push, so no personal email reaches the public history
- [ ] **Maintainer:** reserve the six npm names before the repo is public (placeholders `0.0.0`)
- [ ] **Maintainer (not blocking):** Cloudflare Email Routing on hollware.com so `conduct@hollware.com` (Code of Conduct contact) reaches you
- [ ] **Maintainer:** require 2FA for the `hollware` GitHub org; install the pkg.pr.new GitHub App on it before CI lands (review H1, M2)
- [ ] `gh repo create hollware/hollware --public` and push
- [ ] Repo settings via `gh api`: private vulnerability reporting, secret scanning + push protection, CodeQL default setup, Dependabot alerts (no PRs), Actions `sha_pinning_required`, fork PRs need approval, read-only workflow token that may create PRs, `main` ruleset on the default branch only (no force-push, no deletion), tag ruleset `*@*` and `@*/*@*`, immutable releases, environment `npm` (only `main`, maintainer approval, `prevent_self_review: false`)

### Wave 1 (parallel)

- [x] **F0-1 Governance** — owns root `LICENSE`, `README.md`, `CONTRIBUTING.md`, `CODE_OF_CONDUCT.md`, `SECURITY.md`, `.github/ISSUE_TEMPLATE/`, `.github/pull_request_template.md`, `.github/CODEOWNERS`
  - MIT `LICENSE` ("Copyright (c) 2026-present Sergio Azócar and Hollware contributors"); `README.md` (thesis, principles, status, roadmap); `CONTRIBUTING.md`; `CODE_OF_CONDUCT.md` (Contributor Covenant 2.1 with a real contact, no `[INSERT` left); `SECURITY.md` (GitHub private vulnerability reporting only)
- [x] **F0-2 Design and ADRs** — owns `docs/`
  - `docs/design.md`: English adaptation of design v0.2 (source path and ADR titles are given in the dispatch), without the EmDash spike, with the execution decisions
  - `docs/adr/0001…0014-*.md` (Status, Context, Decision, Consequences, Alternatives) + `docs/adr/README.md` (index and template). ADR-014 = the release pipeline
- [x] **F0-3a Packages** — owns `packages/*`
  - Complete manifests (`exports` with `types`, `files`, `license`, `engines`, `repository {url, directory}`, `publishConfig {access, provenance}`); an identical copy of the root `LICENSE` in each package; `src/index.ts`; `vite.config.ts` with `pack: { dts: { generator: 'tsgo' }, exports: true }`; `tsconfig.json` extending `tsconfig.base.json`; `README.md`; `AGENTS.md`; smoke tests that never need `dist`; `hollware` and `create-hollware` bins answer `--version` and `--help`
- [x] **F0-3b Cloudflare walking skeleton** — owns `apps/playground`, `templates/starter`, `examples/`
  - Worker via `@cloudflare/vite-plugin` (compatibility date ≤ 2026-10-06, the bundled workerd): `vp dev` from the package directory serves `/health`
  - Tests through `apps/playground/vitest.config.ts` (workerd, `@cloudflare/vitest-plugin`) and `vitest.*.config.ts` (Node, wrangler's `createTestHarness`)
  - A named `WorkerEntrypoint` called over a service binding by a second Worker that also lives in the playground (review H5)
  - D1 with `migrations_dir: node_modules/@hollware/server/migrations`; `wrangler types` + `types:check`; one `wrangler check startup`; `wrangler deploy --dry-run` without an account
- [x] **F0-4 CI and releases** — owns `.github/workflows/`, `.changeset/`, `.github/AGENTS.md`
  - `ci.yml` (push to `main`, PRs): `voidzero-dev/setup-vp@68f39c78aaf39be468cabd2afb09c162574c84af # v1.21.2` (exact `version`, Node from `.node-version`), `vp run check:push`; changeset check with `fetch-depth: 0` (PRs: `changeset status --since=origin/main`; pushes: `--since=<before>`, skipped when `before` is all zeros or the commit is the Version Packages merge — review C2); `pnpm exec pkg-pr-new publish --pnpm './packages/*'`
  - `security.yml`: dependency review (PRs), OpenSSF Scorecard (its job may hold `id-token: write`), zizmor, weekly `pnpm audit --prod --audit-level=high`
  - `release.yml` (`changesets/action/*@ae32849d5ba541f9ae29e40e22a623bc13562f51 # v2.1.2`), `permissions: {}`, concurrency `release`, `if: github.repository == 'hollware/hollware'`, `workflow_dispatch` with a finalize-only path:
    - `select-mode` → `version` (Version Packages PR) → `pack` (tarballs + their sha256 as an artifact)
    - `stage` (environment `npm`, `id-token: write`, **no checkout and no repo code**; `actions/setup-node` pinned to Node 24.21.0, whose npm supports staging; verifies each tarball's sha256, then `npm stage publish <tgz> --provenance --access public`; prints the hashes for the maintainer — review C3)
    - maintainer approves on npm with 2FA
    - `finalize` (`timeout-minutes`; waits until the versions are live, checks `dist.attestations`, creates tags and GitHub Releases with an explicit token, never persisted credentials — review H6)
  - `.changeset/config.json`: `fixed: [[six packages]]`, `access: public`, `privatePackages: {version: false, tag: false}`; version script `changeset version && pnpm install --lockfile-only && vp fmt`; spike: Changesets 3 on pnpm 12

### Wave 2

- [~] **F0-5 Verification surface** — owns root `AGENTS.md` (extends it) and `tests/`
  - Convention tests: manifest fields; identical `LICENSE` copies; no `CLAUDE.md`; `core` has no Cloudflare imports (regex scan: TypeScript 7 has no JS compiler API); every bare import is declared; every dependency uses `catalog:`; the `fixed` group equals the public packages; pnpm policy present and every `minimumReleaseAgeExclude` has a reason and an expiry; workflows (40-char SHA + `# vX.Y.Z`, subpath actions allowed, `permissions: {}` at the top, `id-token: write` only in `release.yml` `stage` and the Scorecard job, `persist-credentials: false`, no `NPM_TOKEN` / `npm publish` / `npx` / `dlx`); the ADR index matches the ADR files
  - Meta-tests: backtick paths in `AGENTS.md`/`README.md` exist; `AGENTS.md` cites only real scripts and tasks; `AGENTS.md` ≤ 12,000 characters; every test file belongs to a test project; exception lists may only shrink; every patch has a reason and a test; each guard has a self-test proving it can fail
  - A failing cross-file check in a file F0-5 doesn't own is reported, and the orchestrator routes the fix

### F0-6 First CI release (maintainer + orchestrator)

- [x] The orchestrator adds the first changeset (`patch` for all six) in the same commit as the packages, so CI's changeset check passes from the first push
- [ ] **Maintainer:** right before the first release, `npm trust github <pkg> --file release.yml --repo hollware/hollware --env npm --allow-stage-publish` ×6 (2FA), then set each package to "require 2FA and disallow tokens"
- [ ] Ship `0.0.1` through CI: Version Packages PR → merge → `npm` environment click → 2FA approval → tags and releases

### F0-7 Close

- [ ] Acceptance, reviewers, clean clone, CI green, summary, pause

### Acceptance criteria

| #       | Criterion                   | Verification                                                                                                                                              |
| ------- | --------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| AC-F0-1 | Public repo with governance | `gh api repos/hollware/hollware --jq .visibility` → `public`; private vulnerability reporting enabled; the governance files exist                         |
| AC-F0-2 | Design and ADRs             | convention tests: required headings in every ADR, and the index matches the files                                                                         |
| AC-F0-3 | Clean clone works           | `git clone` into a temp dir, `pnpm install --frozen-lockfile && vp run check:push` → exit 0, with the expected number of tests per project                |
| AC-F0-4 | Walking skeleton            | `vp dev` in `apps/playground` + `curl /health` → 200; the workerd and harness tests pass; `wrangler deploy --dry-run` succeeds                            |
| AC-F0-5 | Publishable packages        | `publint --strict` clean; `pnpm pack --dry-run --json` lists only `dist` (plus `migrations` for the server), README, LICENSE and `package.json`           |
| AC-F0-6 | Guards bite                 | guards pass; deliberate violations (e.g. adding a `CLAUDE.md`) fail them                                                                                  |
| AC-F0-7 | CI green on `main`          | every workflow run for `HEAD` concluded `success`                                                                                                         |
| AC-F0-8 | Single version              | a trial `changeset version` (with `changelog: false`) in a temp worktree bumps all six to the same version                                                |
| AC-F0-9 | Release pipeline proven     | `npm view <pkg>@0.0.1 dist.attestations` shows provenance for all six; `npm audit signatures` passes in a scratch project; tags and GitHub Releases exist |

### Adversarial review (2026-10-11)

C1 root `vp test` had no projects → `test.projects` added. C2 the changeset check would redden `main` → skip rules and a first changeset with the packages. C3 the `stage` job was unpinned → pinned Node/npm, no repo code, sha256 check. H1 pkg.pr.new before the App exists → the maintainer installs it first. H2 wave order inverted → `break-line` and the test bar moved to F0-0. H3 root gaps → `fmt.ignorePatterns`, script interface, `yaml`, `vp fmt` after versioning. H4 per-package `LICENSE` copies. H5 second Worker inside the playground, server ships its migrations, compatibility date, workerd lint override. H6 finalize uses an explicit token, a tag pattern for scoped packages, a timeout and a finalize-only path. H7 F0-2 gets its inputs, ADR index test, real Code of Conduct contact. M1 acceptance wording tightened. M2 org 2FA, SHA pinning, fork approvals, self-review allowed, npm "disallow tokens". M3 `dts.generator`, subpath actions in the SHA test. M4 `tsconfig.base.json`, `*.tgz` and `.vitest/` ignored; v0.1 tasks come with v0.1.

### Verification log

- 2026-10-11 — F0-0: `vp --version` → 1.1.0; install passes supply-chain policies (199 entries); a probe file triggered `no-explicit-any`, `node/no-process-env`, `consistent-type-assertions` and `no-floating-promises`.
- 2026-10-11 — F0-0: `vp test --project repo` → 8 passed; `break-line` on its own restore block and on its exit-code map → both `CAUGHT`, file restored byte for byte.
- 2026-10-11 — F0-1 accepted: governance files reviewed; `grep -rIn "sergioazoc@"` → nothing; Code of Conduct contact `conduct@hollware.com`.
- 2026-10-11 — F0-2 accepted: 14 ADRs + index (structure check: 14 files, 14 rows, 0 failures; 4 break-line mutations CAUGHT); `docs/design.md` 750 lines with the validation table; the only `sergioazocar` mention is the out-of-scope note. Note for the maintainer: several "Alternatives considered" were inferred by the writer (ADR 006, 008–011, 013 and parts of 002, 004, 005, 007).
- 2026-10-11 — F0-3a accepted: 34 package tests; `publint --strict` clean ×6; LICENSE copies byte-identical; two builds leave manifests unchanged; orchestrator mutations on the CLI message and the core name → CAUGHT.
- 2026-10-11 — F0-3b accepted: 11 tests (`playground:workerd` 7, `playground:harness` 1, `starter:workerd` 3); `types:check` up to date; `deploy:dry` without an account; startup 0.82 KiB, ~2.5 ms sampled; S6 (harness over Vite output) and S9 (dev and `d1 --local` share state) de-risked; vite-plus#2481 not reproduced; workers-sdk#15618 only with `fsModuleCache: true`. Orchestrator mutation on `ping` → CAUGHT.
- 2026-10-11 — F0-4 accepted: every `uses:` pinned by SHA; `id-token: write` only in `stage` and `scorecard`; `permissions: {}` ×3; 10/10 checkouts without persisted credentials; logic suites 13 + 30 + 29 green; actionlint, shellcheck and zizmor (online, pedantic) clean; trial `changeset version` moved all six to 0.0.1.
- 2026-10-11 — Integration: `vp run check:push` green (111 files formatted, 53 tests, publint ×6, types up to date, 19 tasks); six commits, one per WP.

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
