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
- [x] `scripts/break-line.ts` + 8 tests (moved here from F0-5, review H2); two self-mutations reported `CAUGHT`. F0-7 rebuilt it: it runs a baseline first, and has a timeout and signal handling (56 tests)
- [x] Root `AGENTS.md` with the test bar (moved here from F0-5, review H2)
- [x] First local commit
- [x] Repo-local git identity uses the GitHub noreply address (`6147546+sergioazoc@users.noreply.github.com`); the local commits were re-authored before the first push, so no personal email reaches the public history
- [x] **Maintainer:** reserve the six npm names before the repo is public (placeholders `0.0.0`)
- [ ] **Maintainer:** DNS for hollware.com. The zone is empty, so the `homepage` of every published manifest and the Code of Conduct contact (`conduct@hollware.com`) lead nowhere. Needed: Cloudflare Email Routing (`conduct@`, plus an address for the npm account) and a redirect to the repository until the site exists (F0-7 review S6/P3)
- [x] **Maintainer:** org setting "Allow GitHub Actions to create and approve pull requests" (the Version Packages PRs #1 and #2 were opened by the bot)
- [x] **Maintainer:** require 2FA for the `hollware` GitHub org; install the pkg.pr.new GitHub App on it (review H1, M2)
- [x] `gh repo create hollware/hollware --public` and the first push
- [x] Repo settings via `gh api`: private vulnerability reporting, secret scanning + push protection, CodeQL default setup, Dependabot alerts (no PRs), Actions `sha_pinning_required`, fork PRs need approval, read-only workflow token that may create PRs, `main` ruleset (no force-push, no deletion), `release` ruleset (no force-push, no deletion, required check `Check`), tag ruleset `*@*` and `@*/*@*` (no update, no deletion), immutable releases, environment `npm` (only `release` since ADR-015, maintainer approval, `prevent_self_review: false`)

### Wave 1 (parallel)

- [x] **F0-1 Governance** — owns root `LICENSE`, `README.md`, `CONTRIBUTING.md`, `CODE_OF_CONDUCT.md`, `SECURITY.md`, `.github/ISSUE_TEMPLATE/`, `.github/pull_request_template.md`, `.github/CODEOWNERS`
  - MIT `LICENSE` ("Copyright (c) 2026-present Sergio Azócar and Hollware contributors"); `README.md` (thesis, principles, status, roadmap); `CONTRIBUTING.md`; `CODE_OF_CONDUCT.md` (Contributor Covenant 2.1 with a real contact, no `[INSERT` left); `SECURITY.md` (GitHub private vulnerability reporting only)
- [x] **F0-2 Design and ADRs** — owns `docs/`
  - `docs/design.md`: English adaptation of design v0.2 (source path and ADR titles are given in the dispatch), without the EmDash spike, with the execution decisions
  - `docs/adr/0001…0015-*.md` (Status, Context, Decision, Consequences, Alternatives) + `docs/adr/README.md` (index and template). ADR-014 = the release pipeline (superseded by ADR-015: `release` branch and direct publishing)
- [x] **F0-3a Packages** — owns `packages/*`
  - Complete manifests (`exports` with `types`, `files`, `license`, `engines`, `repository {url, directory}`, `publishConfig {access, provenance}`); an identical copy of the root `LICENSE` in each package; `src/index.ts`; `vite.config.ts` with `pack: { dts: { generator: 'tsgo' }, exports: { customExports } }` (an explicit `types` condition); `tsconfig.json` extending `tsconfig.base.json`; `README.md`; `AGENTS.md`; smoke tests that never need `dist`; `hollware` and `create-hollware` bins answer `--version` and `--help`
- [x] **F0-3b Cloudflare walking skeleton** — owns `apps/playground`, `templates/starter`, `examples/`
  - Worker via `@cloudflare/vite-plugin` (compatibility date ≤ 2026-10-06, the bundled workerd): `vp dev` from the package directory serves `/health`
  - Tests through `apps/playground/vitest.config.ts` (workerd, `@cloudflare/vitest-plugin`) and `vitest.*.config.ts` (Node, wrangler's `createTestHarness`)
  - A named `WorkerEntrypoint` called over a service binding by a second Worker that also lives in the playground (review H5)
  - D1 with `migrations_dir: node_modules/@hollware/server/migrations`; `wrangler types` + `types:check`; one `wrangler check startup`; `wrangler deploy --dry-run` without an account
- [x] **F0-4 CI and releases** — owns `.github/workflows/`, `.changeset/`, `.github/AGENTS.md`
  - `ci.yml` (push to `main`, PRs): `voidzero-dev/setup-vp@68f39c78aaf39be468cabd2afb09c162574c84af # v1.21.2` (exact `version`, Node from `.node-version`), `vp run check:push`; changeset check with `fetch-depth: 0` (PRs: `changeset status --since=origin/main`; pushes: `--since=<before>`, skipped when `before` is all zeros or the commit is the Version Packages merge — review C2); `pnpm exec pkg-pr-new publish --pnpm './packages/*'`
  - `security.yml`: dependency review (PRs), OpenSSF Scorecard (its job may hold `id-token: write`), zizmor, weekly `pnpm audit --prod --audit-level=high`
  - `release.yml` (`changesets/action/*@ae32849d5ba541f9ae29e40e22a623bc13562f51 # v2.1.2`), `permissions: {}`, concurrency per ref (`release-${{ github.ref }}`, never cancelled), `if: github.repository == 'hollware/hollware'`, `workflow_dispatch` with a finalize-only path. As rebuilt by ADR-015 on 2026-10-12 (the staged flow of ADR-014, with a `stage` job and a 2FA approval on npm, is retired):
    - on `main`: `select-mode` → `version` (Version Packages PR)
    - on `release`: `promotion-check` (the commit is on `main`, the push is a fast-forward, no pending changeset) → `pack` (tarballs + `publish-plan.json` with their sha256, as an artifact)
    - `publish` (environment `npm`, `id-token: write`, **no checkout and no repo code**, Node 24.21.0; verifies the plan and every tarball, then `npm publish --provenance` per package and skips versions already on npm — review C3)
    - `finalize` (`timeout-minutes`; waits until the versions are live with provenance, creates tags and GitHub Releases with an explicit token, never persisted credentials — review H6)
  - `.changeset/config.json`: `fixed: [[six packages]]`, `access: public`, `privatePackages: {version: false, tag: false}`; version script `changeset version && pnpm install --lockfile-only && vp fmt`; spike: Changesets 3 on pnpm 12

### Wave 2

- [x] **F0-5 Verification surface** — owns root `AGENTS.md` (extends it) and `tests/`
  - Convention tests: manifest fields; identical `LICENSE` copies; no `CLAUDE.md`; `core` has no Cloudflare imports (parsed with Oxc: TypeScript 7 has no JS compiler API); every bare import is declared; every dependency uses `catalog:`; the `fixed` group equals the public packages; pnpm policy present and every `minimumReleaseAgeExclude` has a reason and an expiry; workflows (40-char SHA + `# vX.Y.Z`, subpath actions allowed, `permissions: {}` at the top, `id-token: write` only in `release.yml` `publish` and the Scorecard job, `persist-credentials: false`, no `NPM_TOKEN` / `npx` / `dlx`, and `npm publish` only in `publish`); the ADR index matches the ADR files
  - Meta-tests: backtick paths in `AGENTS.md`/`README.md` exist; `AGENTS.md` cites only real scripts and tasks; `AGENTS.md` ≤ 12,000 characters; every test file belongs to a test project; exception lists may only shrink; every patch has a reason and a test; each guard has a self-test proving it can fail
  - A failing cross-file check in a file F0-5 doesn't own is reported, and the orchestrator routes the fix

### F0-6 First CI release (maintainer + orchestrator)

- [x] The orchestrator adds the first changeset (`patch` for all six) in the same commit as the packages, so CI's changeset check passes from the first push
- [x] **Maintainer:** stage-only trust for the six packages; `0.0.1` shipped through the staging pipeline (Version Packages PR #1 → environment approval → six staged versions approved with 2FA → tags and releases)
- [x] **Decision (2026-10-11, ADR-015):** no more npm staging; a `release` branch for production. `main` only versions (Version Packages PR); `release` moves by fast-forward to a commit on `main` and publishes directly with OIDC and provenance after the maintainer approves the `npm` environment
- [x] **Maintainer:** trusted publishers replaced with `--allow-publish` (environment `npm`). The first pass missed `@hollware/core`: the helper script piped `npm trust list`, and npm asks for 2FA only on a terminal, so nothing was revoked. Fixed on 2026-10-12, and `.github/AGENTS.md` now says how to run `npm trust`
- [x] Ship `0.0.2` through the new pipeline: changeset → Version Packages PR #2 → merge → `git push origin <version commit>:release` → environment approval → publish → tags and releases (run 38198863769, two attempts, see the verification log)
- [x] **Maintainer:** set the six packages to "Require two-factor authentication and disallow tokens" (`npm access set mfa=publish <package>`, 2026-10-12), which ADR-015 counts on. npm has no way to read it back (`GET /-/package/<name>/access` → 405), so the settings page is the check, and the `0.1.0` release will show that OIDC publishing still works

### F0-7 Close

- [x] Acceptance from a clean clone at `22ff418`: AC-F0-1…9 pass (verification log)
- [x] Three read-only reviewers (structure, tests and evidence, security and product). They reported 8 + 10 + 5 findings; each was checked against the repository, and the runtime claims were reproduced or refuted
- [x] Auto, fixed in this stage:
  - `break-line` runs the command unmutated first (ERROR if it fails), limits each run with `--timeout` (60 s by default), kills the whole process group, and restores the file on SIGINT, SIGTERM and SIGHUP (review T3)
  - Guards (T2, T4, T8/S2, T9):
    - `self-tests` requires, for every exported `check…` (sync, async or const), a self-test block that calls it and asserts;
    - the guard registry moved to `tests/AGENTS.md`;
    - `test-projects` ends the open exemption of `tests/acceptance/` and `tests/conformance/`: once they hold a test, their task must exist and CI must reach it;
    - new `disabled-tests` and `worker-projects` guards.
  - Release (T1, T5, T6, P4):
    - `finalize-release.sh` has 29 tests, and a finalize-only run no longer settles silently on an older release (new `release_sha` input);
    - `promotion-check` fails a push without a previous tip;
    - `changeset-check` fails instead of skipping a push it cannot compare;
    - the release guard pins the scripts' env, `fetch-depth`, concurrency and the `finalize_only` wiring.
  - The playground's D1 order and its RPC answer are observable, and the starter's three identical rows are one test (T7)
  - Docs (S3–S5, S7, T10, P4):
    - the F0 checklists above;
    - `docs/design.md` (risks, CLI scope, catalog) and the README's CLI scope;
    - ADR-008's link, and ADR-015's consequences (what the rulesets enforce, recovering from a stray push);
    - `.github/AGENTS.md`: promote after an ancestry check, the recovery, the tag ruleset.
  - `.claude/` and `.mcp.json` are ignored (P5)
- [ ] **Ask (maintainer):**
  - the credentials the agents use can approve the `npm` environment, which ADR-015 says they must not (P1);
  - DNS for hollware.com (S6/P3, see F0-0);
  - the npm account's personal email on the published manifests (P2);
  - optional: deprecate the `0.0.0-stage` and `0.0.0` versions (S7), and limit the creation of `*@*` tags to the workflows (P4).
- [ ] Settle before v0.1 Wave 0, listed there: workspace resolution without a build (S1), where the operation specs live (S3), `core`'s type environment (S8)
- [ ] CI green on the close commits, then the summary to the maintainer and the pause

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

Each entry records what was verified on its date. Later entries supersede earlier ones; the checklists above describe the current state.

- 2026-10-11 — F0-0: `vp --version` → 1.1.0; install passes supply-chain policies (199 entries); a probe file triggered `no-explicit-any`, `node/no-process-env`, `consistent-type-assertions` and `no-floating-promises`.
- 2026-10-11 — F0-0: `vp test --project repo` → 8 passed; `break-line` on its own restore block and on its exit-code map → both `CAUGHT`, file restored byte for byte.
- 2026-10-11 — F0-1 accepted: governance files reviewed; `grep -rIn "sergioazoc@"` → nothing; Code of Conduct contact `conduct@hollware.com`.
- 2026-10-11 — F0-2 accepted: 14 ADRs + index (structure check: 14 files, 14 rows, 0 failures; 4 break-line mutations CAUGHT); `docs/design.md` 750 lines with the validation table; the only `sergioazocar` mention is the out-of-scope note. Note for the maintainer: several "Alternatives considered" were inferred by the writer (ADR 006, 008–011, 013 and parts of 002, 004, 005, 007).
- 2026-10-11 — F0-3a accepted: 34 package tests; `publint --strict` clean ×6; LICENSE copies byte-identical; two builds leave manifests unchanged; orchestrator mutations on the CLI message and the core name → CAUGHT.
- 2026-10-11 — F0-3b accepted: 11 tests (`playground:workerd` 7, `playground:harness` 1, `starter:workerd` 3); `types:check` up to date; `deploy:dry` without an account; startup 0.82 KiB, ~2.5 ms sampled; S6 (harness over Vite output) and S9 (dev and `d1 --local` share state) de-risked; vite-plus#2481 not reproduced; workers-sdk#15618 only with `fsModuleCache: true`. Orchestrator mutation on `ping` → CAUGHT.
- 2026-10-11 — F0-4 accepted: every `uses:` pinned by SHA; `id-token: write` only in `stage` and `scorecard`; `permissions: {}` ×3; 10/10 checkouts without persisted credentials; logic suites 13 + 30 + 29 green; actionlint, shellcheck and zizmor (online, pedantic) clean; trial `changeset version` moved all six to 0.0.1.
- 2026-10-11 — Integration: `vp run check:push` green (111 files formatted, 53 tests, publint ×6, types up to date, 19 tasks); six commits, one per WP.
- 2026-10-11 — F0-5 accepted: 36 guard files in the `repo` project (309 tests), each guard with a self-test on a bad fixture; 58 break-line mutations by the writer and 3 by the orchestrator → CAUGHT; `check:push` now also runs `scripts/check-bins.ts` (20 tasks, 354 tests, green). `break-line` now reports argument errors as ERROR (exit 2) instead of crashing with exit 1.
- 2026-10-11 — npm: the six names hold `0.0.0` placeholders. GitHub: `hollware/hollware` created public with private vulnerability reporting, Dependabot alerts, secret scanning + push protection, squash-only merges titled by the PR, SHA pinning required, read-only workflow token, fork approval for external contributors, environment `npm` (maintainer review, `main` only), rulesets for `main` and release tags, immutable releases.
- 2026-10-12 — `0.0.1` released through the staging pipeline: the six staged tarballs matched the CI pack byte for byte (sha1), `dist.attestations` show SLSA v1 provenance for all six, tags and GitHub Releases exist (`hollware` marked Latest), `npm audit signatures` → 6 verified registry signatures and 6 verified attestations. The changeset check had to skip the Version Packages PR (fixed in `5a55713`, bound by `tests/ci/changeset-check.test.ts`).
- 2026-10-12 — ADR-015 implemented: `release.yml` versions on `main` and promotes/packs/publishes/finalizes on `release`; 418 tests, `check:push` green, actionlint/shellcheck/zizmor clean; orchestrator mutations on the environment and the ancestor check → CAUGHT.
- 2026-10-12 — `0.0.2` released from `release` (run 38198863769). Attempt 1 published `@hollware/admin`, `hollware` and `@hollware/client`, then npm refused `@hollware/core` with `403 OIDC permission denied for this action`: its trusted publisher was still stage-only. Once the maintainer fixed it, attempt 2 skipped those three and published `@hollware/core`, `create-hollware` and `@hollware/server`. `finalize` tagged `b297541` six times and created six immutable releases (`hollware@0.0.2` Latest). All six: `latest` is 0.0.2; SLSA v1 provenance built from `refs/heads/release` by `.github/workflows/release.yml`; the tarballs on npm equal the CI pack (sha512 and sha1); `npm audit signatures` → 6 verified registry signatures and 6 verified attestations.
- 2026-10-12 — F0-7 acceptance from a clean clone of `22ff418`:
  - AC-F0-1: `visibility=public`, `private_vulnerability_reporting=true`, the governance files and issue forms exist.
  - AC-F0-3: `pnpm install --frozen-lockfile` and `vp run check:push` exit 0, with 418 tests: repo 373, packages 34, Workers 11.
  - AC-F0-4: `GET /health` → 200 `{"ok":true,"name":"hollware-playground"}` under `vp dev`; `deploy:dry` → 0.82 KiB.
  - AC-F0-5: each tarball holds only `LICENSE`, `README.md`, `dist/` (plus `migrations/` for the server) and `package.json`.
  - AC-F0-6: a root `CLAUDE.md` fails two guards, and a broken path in `.github/AGENTS.md` is CAUGHT.
  - AC-F0-7: the four workflows are green on `22ff418`.
  - AC-F0-8: a trial changeset moves all six to 0.0.3.
  - AC-F0-9: `0.0.1` and `0.0.2` (above).
- 2026-10-12 — F0-7 review fixes, integrated from four worktrees:
  - `vp run check:push` exit 0, with 54 files and 565 tests; actionlint, shellcheck and zizmor are clean.
  - Orchestrator mutations with the new `break-line`, each with a passing baseline and failing in the test that names the line → CAUGHT: 10 release mutations (scripts, `release.yml`, `ci.yml`), 4 guard and Worker mutations, and 2 on `break-line` itself.
  - The old `break-line` printed CAUGHT for a command that always fails (reproduced). So the mutation counts in the entries above were taken without a baseline run.

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

### Settle before Wave 0 dispatch (F0-7 review)

- [ ] Workspace resolution without a build (review S1, reproduced). Every package resolves only to `dist`, and `check:push` builds after `vp check` and `vp test`. So on a clean checkout, the first import of one workspace package by another fails, and a change to `core` stays invisible to `server` until a rebuild. Decide between building first and resolving to source inside the workspace (with `dist` only in the published manifest), and adjust the `manifests` guard to the choice
- [ ] Where the operation specs live (review S3). This plan puts them in `core` (`core/src/operations/`, with the handlers in `server/src/ops`). `docs/design.md`, ADR-003, the README and the package descriptions say `server` holds the operation registry. ADR-016 settles it, and the docs follow in the same commit
- [ ] `core`'s type environment (review S8). `core` type-checks with Node types and its tests run only in Node, while the `core-purity` guard checks five Node globals. Either give `core` a runtime-neutral type environment (no Node types) and run its tests in workerd too, or narrow its "runs anywhere" claim

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
| AC-0.1-1  | Static checks and build | `vp check && vp run -r build && vp run -r publint && vp run -r types:check`                                                                                                                                                                         |
| AC-0.1-2  | Unit and integration    | `vp test`                                                                                                                                                                                                                                           |
| AC-0.1-3  | Agent flow (2026-07-28) | `vp run test:acceptance -- agent-flow`: describe_site → invalid draft saved with fixes → publish blocked → fixed update v2 → stale v1 conflict (no new revision) → validate keeps version → publish with warnings via MRTR or `acknowledgeWarnings` |
| AC-0.1-4  | 2025 clients            | initialize → tools/list → get_entry                                                                                                                                                                                                                 |
| AC-0.1-5  | RPC from another Worker | published HTML served, drafts 404, `listEntries` with tag + cursor, `getTranslations` ES/EN pair                                                                                                                                                    |
| AC-0.1-6  | Auth                    | 401 with `resource_metadata`; metadata endpoints; OAuth with the soft passkey; `content:read` token → 403 naming missing scopes; personal token valid/expired/revoked; setup link single use                                                        |
| AC-0.1-7  | MCP conformance         | `vp run test:conformance` with `--requirements 2026-07-28` and `2025-11-25` → exit 0                                                                                                                                                                |
| AC-0.1-8  | Budgets                 | `vp run check:budgets` vs `budgets.json` (S7 + 15 %); raising it needs an ADR note                                                                                                                                                                  |
| AC-0.1-9  | Import                  | synthetic corpus: 10 entries, 5 groups, tags; a second run creates 0 revisions                                                                                                                                                                      |
| AC-0.1-10 | Migrations              | fresh migrate; re-run is a no-op; `migrate --check`; lock test                                                                                                                                                                                      |
| AC-0.1-11 | Clean clone             | clone + `pnpm install --frozen-lockfile && vp run check:push && vp run test:acceptance`                                                                                                                                                             |
| AC-0.1-12 | Tests can fail          | `break-line` on the version predicate, scope gate, publish gate, DNS guard and RPC read-only filter turns each matching AC red                                                                                                                      |
| AC-0.1-13 | Release 0.1.0           | published through the pipeline with provenance, approved by the maintainer                                                                                                                                                                          |

New ADRs: 016 operation/outcome shapes · 017 auth topology · 018 append-only revisions with derived columns · 019 conformance baseline policy · 020 fix-forward migrations.

---

## Later stages (detailed at the start of each stage)

- **v0.2 Publishing** — publish Workflow tracked as an MCP Task + scheduling; outbox → Queue → HMAC webhooks, IndexNow, custom subscribers, DLQ; revision diff, restore and trash (`delete_entry`/`restore_entry`); media in R2 + Images; FTS5 search; HTTP API + OpenAPI 3.1 + ETag + Workers Cache + purge; `@hollware/client` (binding or HTTP); `export`, `reparse`, `reindex`, cron backups; `audit_log`; optional write-time highlighting. **Exit:** on the demo (`demo.hollware.com`), publish over MCP is live in < 60 s with no CI.
- **v0.3 Admin** — Vue 3.5 + Nuxt UI 4 + Vue Router 5 SPA shipped in `@hollware/admin`; PKCE first-party client; editor (CodeMirror 6 + Comark preview), contract-driven forms, review queue with diff, approval via Workflow `waitForEvent`; identity screens. **Exit:** an agent's post approved from the admin; axe clean.
- **v0.4 Distribution** — `create-hollware` + starter + `hollware deploy`/`doctor`; read tokens and site isolation; Docus docs on hollware.com written in Hollware; `@hollware/nuxt`. **Exit:** a docs-only sub-agent and an external person install Hollware from the docs.
- **v0.5 Intelligence** — embeddings (Workers AI + Vectorize), semantic/hybrid search, related entries, Analytics Engine + `content_stats`, `@hollware/agents` (Agents SDK, never `content:publish`). **Exit:** an agent picks what to update from metrics and publishes it through the contracts.
- **v1.0 Stable** — stability ADR, API guards (oasdiff, api-extractor, publint, attw, migrations lock), `cf`/Drizzle v1 if GA, importers, security review, `@hollware/astro`, `@hollware/next`. **Exit:** hollware.com + the demo + at least one external site in production; this file is deleted.

Out of scope for this plan: migrating sergioazocar.com. It happens after v1.0 with its own plan in that repository.
