# Hollware implementation plan

> Temporary file. It tracks the roadmap from F0 to v1.0 and is deleted when v1.0 ships
> (together with its mention in `AGENTS.md`). The design lives in `docs/design.md`;
> decisions live in `docs/adr/`.

- **Status:** v0.1 in progress (F0 closed on 2026-10-12) · **Started:** 2026-10-11
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
- [x] **Ask (maintainer)**, delivered on 2026-10-12; the open ones moved to "Maintainer actions" in v0.1:
  - the credentials the agents use can approve the `npm` environment, which ADR-015 says they must not (P1);
  - DNS for hollware.com (S6/P3, see F0-0);
  - the npm account's personal email on the published manifests (P2);
  - optional: deprecate the `0.0.0-stage` and `0.0.0` versions (S7), and limit the creation of `*@*` tags to the workflows (P4).
- [x] Listed under "Settle before Wave 0 dispatch" in v0.1: workspace resolution without a build (S1), where the operation specs live (S3), `core`'s type environment (S8)
- [x] CI green on the close commits, then the summary to the maintainer and the pause

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
- 2026-10-12 — F0 closed: every workflow on `70028e4` concluded `success` (CI 38220449987, Release 38220449979, Security 38220449957 and 38247703228, CodeQL 38220449882). The summary went to the maintainer, who resumed the work the same day.

---

## v0.1 — Core

**Goal:** an agent, authenticated with a personal token, writes and publishes over MCP with
contracts validated at write time, and an example site reads what was published over RPC.

### Stage start (2026-10-12)

- [x] Stack check: nothing moved since the plan was written. Base: vite-plus 1.1.0 (Vite 8.3.3, Rolldown 1.2.12, tsdown 0.23.0, Vitest 5.0.3), Node 24.21.0 (Node 26 is not LTS yet), pnpm 12.11.2, wrangler 4.149.0, `@cloudflare/vite-plugin` 1.63.1, `@cloudflare/vitest-plugin` 1.4.0, TypeScript 7.0.2. Stage candidates: hono 5.0.0-rc.1 (stable: 4.13.13), `@modelcontextprotocol/server` and `client` 2.3.1, `@modelcontextprotocol/conformance` 0.2.0-alpha.12, comark / `@comark/html` / `@comark/vue` 0.7.0 (they pin markdown-exit 1.1.0-beta.2), drizzle-orm 0.45.4 and drizzle-kit 0.31.11 (v1 still in RC), `@cloudflare/workers-oauth-provider` 1.2.3, `@simplewebauthn/server` 14.0.3, `@standard-schema/spec` 1.1.0. zod: the lockfile already holds 4.6.5 through `@cloudflare/vitest-plugin`, and pinning 4.6.6 in a spike added a second copy, so the catalog pins the copy the lockfile has
- [x] Adversarial review of this section, answered before Wave 0 (below; 1 critical, 10 high, 11 medium, 3 low)

### Maintainer actions (open)

- [ ] Before the `0.1.0` release (AC-0.1-13), no credential an agent can reach may approve the `npm` environment (F0-7 P1): a fine-grained token for Hollware sessions without Administration, Deployments, Environments or Secrets; GitHub CLI denied in the org's OAuth app policy; `deny`/`ask` rules for `gh api` on `pending_deployments`, `environments` and `rulesets`
- [ ] DNS for hollware.com: Email Routing (`conduct@`, `npm@`) and a 302 redirect to the repository
- [ ] The npm account's email moves to an `@hollware.com` address once routing works
- [ ] Optional: deprecate the `0.0.0-stage` and `0.0.0` placeholders; read the "Alternatives considered" the F0-2 writer inferred (ADR 006, 008–011, 013 and parts of 002, 004, 005, 007)
- Deferred: limiting the creation of `*@*` tags to the workflows needs the Actions bot as a ruleset bypass actor, tested outside a release

### Spikes (orchestrator, before dispatch)

Run on 2026-10-12 in isolated scratch clones by sub-agents, then re-run and mutated by the orchestrator (verification log below). No fallback was needed.

- [x] S1 Hono 5 RC under `vp dev` and workerd: keep 5.0.0-rc.1. `onError`/`notFound` became middleware, and a Hono 4 style handler silently answers a plain-text 500; that code lives in `http/errors.ts`, and a test asserts the JSON error body
- [x] S2 MCP SDK 2.3.1 in workerd, both eras: `createMcpHandler(factory)` on a Hono route, cfworker validation, MRTR in the 2026 era only. Converting Zod to JSON Schema on every request costs ~1.4 ms for a registry of this plan's size, so the converted schemas are memoized per isolate (byte-identical `tools/list`)
- [x] S3 Comark + `@comark/html` in workerd without Node: works, but the defaults are unsafe for stored content (raw HTML and props pass through, `autoClose` is quadratic on hostile input, heading ids drop non-ASCII letters); the safe parser configuration is in the log
- [x] S4 D1 + drizzle 0.45.4: the optimistic write is one `db.batch` of `INSERT…SELECT` + `UPDATE…RETURNING`; drizzle runs on a session through a typed adapter; Miniflare does not enforce the 2 MB row limit
- [x] S5 SimpleWebAuthn 14 + a software authenticator in workerd without Node: full ceremony and negative cases pass on the built Worker; the authenticator becomes the auth WP's test double. workers-oauth-provider 1.2.3 with Hono 5: works with its role-based API (see the log)
- [x] S6 `createTestHarness` with Vite output, named entrypoint, `applyD1Migrations` from `node_modules` (de-risked in F0-3b, see the F0 verification log)
- [~] S7 `wrangler check startup` on built output → calibrate budgets. Per-library startup and sizes are measured (log); the budgets are calibrated on the built server in Wave 3
- [x] S8 MCP conformance 0.2.0-alpha.12 against a stub Worker: no stack problem; the stub fails only unimplemented capabilities and missing `test_*` fixture tools (baselines of 32 and 26 entries, one file per revision)
- [x] S9 do `vp dev` and `wrangler d1 execute --local` share state? (yes, F0-3b)

### Adversarial review (2026-10-12)

A read-only reviewer criticized this section after the spikes and the three settled decisions. The orchestrator checked the key findings against the repository and the libraries (the conformance CLI has no credential option; Comark's `security` drops a disallowed tag unless `tagFallback` is given; `packages/server` has no Workers types, dependencies or test project). The maintainer took three decisions the same day: personal tokens only in v0.1 (ADR-019), content safety as write-time contracts (ADR-020), and the starter opts out of Node.js compatibility too. Each finding and its answer:

- **C1** OAuth needs a setup link, a sign-in and a consent page that nobody owned or tested → v0.1 authenticates with personal tokens only; OAuth, passkeys, setup links, sign-in and consent move to v0.3 with the admin (ADR-019).
- **H1** Wave 0 did not compile (`server` without Workers types, dependencies or test project; root tasks and CI steps unowned) → Wave 0 items 0.2–0.4 and 0.8, owned by the orchestrator; Wave 0 files are frozen and change only through the orchestrator.
- **H2** An acceptance suite "written first" breaks `disabled-tests` and `test-projects` and cannot be probed by `break-line` → every WP ships integration tests that are green in its own wave; the acceptance suite is written in Wave 4, with its task, runner and CI step, in one commit.
- **H3** Wave 1 and Wave 3 dependencies → Wave 0 ships the schema and migrations, the personal token format in `core`, and the test support; Wave 3 is split into 3a (composition) and 3b (playground and conformance).
- **H4** Conformance cannot send credentials, and baselines can hide anything → a proxy in `tests/conformance` adds a personal token and keeps Host and Origin, in front of `wrangler dev` of the built playground; ADR-022 before WP10: one baseline entry per check with a class and a reason, a shrink-only count, and a must-pass profile that no baseline may list.
- **H5** `security({ allowedTags })` deletes unknown components before the contract sees them → ADR-020: a disallowed node becomes a marker through `tagFallback`, and the contracts report it; one parser per isolate and allowed tag set; `allowedTags` is never empty; a `::youtub` case in WP2 and WP3.
- **H6** A child row in the optimistic batch turns a stale write into a foreign key error; D1 limits missing → child rows are inserted only `WHERE EXISTS` their revision; lookups go in chunks of at most 90 parameters; `size-limit` counts the UTF-8 bytes of the whole row; `maxMarkdownBytes` defaults to 512 KiB; tests: a stale write with 30 tags is a `conflict`, 150 tags, 60 internal links.
- **H7** `migrations/0000_init.sql` is published on npm, and drizzle-kit would start its own `0000` → the shipped file stays byte for byte; drizzle-kit starts from a seeded baseline and generates from `0001`; `_hollware_meta` keeps a reasoned exception in the schema guard; a lock file holds the sha256 of every shipped migration (ADR-023).
- **H8** The Node.js opt-out had no owner, test or type environment in `server` → Wave 0 item 0.3: the flags in every Wrangler config, the starter included, a guard, and a probe on the built playground; `server/src` type-checks with the generated Workers runtime types and without Node's (item 0.4).
- **H9** The budget was calibrated against itself, and two CPU limits were mixed → three measures: bytes (minified and gzipped, under an absolute ceiling set before measuring; hard), startup (median of five runs; logged) and CPU per write (cold and warm, logged); minified builds and a lazily imported parser are WP11 deliverables; the Cloudflare measurement stays with the v0.2 demo.
- **H10** Site isolation had no test → fixtures with rows of a second site, a stranger test per operation and per RPC method, a `site_id` mutation; `defineConfig` accepts one site per deployment in v0.1, and `tokens` carries `site_id` from the start.
- **M1** OAuth abuse surface and token policy → moved to v0.3 with OAuth (ADR-019); in v0.1 a personal token expires after 90 days by default, one challenge names every missing scope, and `/v1` is not registered before the HTTP API exists.
- **M2** Acknowledged warnings had nowhere to live → an append-only `publications` table in v0.1 records the verdict of each publish, the acknowledged warnings and who published (ADR-021).
- **M3** Enum `CHECK`s would force rebuilds in v0.2, and the third trigger looked only at `id` → the `CHECK` lists include the values the design already plans (`scheduled`); the append-only triggers cover every unique key of `revisions`, and the guard tests `INSERT OR REPLACE` per key; ADR-023 tells additive migrations from rebuilds.
- **M4** Outcomes, errors and views were not fixed → Wave 0 item 0.5 pins, in code and in this plan: outcomes per operation and which are `isError`, the HTTP and RPC equivalents, violations that refuse a write versus those that only block publishing, `get_entry`'s view (`head` or `published`), an output cap that answers `output_too_large` and never truncates, and the full map from effect to MCP hints.
- **M5** WebAuthn and setup link traps → moved to v0.3 with passkeys (ADR-019); the spike's software authenticator and negative tests are kept on the `spikes/v0.1` branch.
- **M6** Spike evidence lived in `/tmp`, and public documents were stale → the spike code and its results are on the `spikes/v0.1` branch; ADR-005, ADR-012 and the design are corrected in the commit of this plan.
- **M7** zod could be installed twice in a user's project → `zod` is a peer dependency of `core` with the range `^4.2.0` (the floor of the MCP SDK) and a dev dependency from the catalog; `catalog-deps` allows a range only in `peerDependencies`; AC-0.1-11 installs the packed tarballs into an empty project and finds one copy.
- **M8** Acceptance criteria that could not fail → rewritten below, each with its observables and the mutation that turns it red.
- **M9** Shared test support → Wave 0 item 0.7: fixtures loaded through Vite in Node and workerd, format ignores for fixtures, `core/bench/` outside `src`, one harness pattern on `http://hollware.test`.
- **M10** The Host and Origin guard was open by default in the spike → it fails closed (ADR-019), and its tests join AC-0.1-6.
- **M11** Attribute policy, `pipelineVersion` and log noise → ADR-020: an allowlist per tag, strict component props, `pipelineVersion` next to `comarkVersion`, the sanitizer's warnings silenced.
- **L1** Wrangler telemetry was off only by hand → `send_metrics: false` in every Wrangler config, under the same guard as the Node.js opt-out, and `WRANGLER_SEND_METRICS=false` in CI.
- **L2** The CLI and secrets, and `import`'s semantics → `import` reads the token from `--token-file` or stdin; token commands use fixed SQL templates with validated values; `import` validates everything first and writes second; `update_draft` answers `unchanged` for identical Markdown and creates no revision.
- **L3** Loose ends → `last_used_at` is written at most once an hour per token; `defineConfig` has a style guide field for `describe_site`; a site key that disappears from the config is reported at startup; ADR-006 and ADR-009 are confirmed or revised at the close, together with the README status.

### Settle before Wave 0 dispatch (F0-7 review)

- [x] Workspace resolution without a build (review S1, reproduced). Every package resolved only to `dist`, so on a clean checkout the first import of one workspace package by another failed, and a change to `core` stayed invisible to `server` until a rebuild. The maintainer chose source resolution on 2026-10-12: [ADR-016](docs/adr/0016-workspace-packages-resolve-to-source.md). Every package builds with tsdown's `devExports`; the guard `manifests` pins the source `exports`/`bin` and the `dist` ones in `publishConfig`; the new guard `build-order` keeps `check:push` checking and testing before it builds; `check-bins` runs the published bin
- [x] Where the operation specs live (review S3). The plan put them in `core` and the documents put the whole registry in `server`. The maintainer chose the specs in `core` and the handlers and adapters in `server` on 2026-10-12: [ADR-017](docs/adr/0017-operation-specs-in-core-handlers-in-server.md). The design, ADR-003 (a clarification), the README, `AGENTS.md` and the package descriptions follow in the same commit. A spec declares its effect and holds no MCP vocabulary: `server` derives the annotations
- [x] `core`'s type environment (review S8). `core` type-checked with Node types and ran its tests only in Node, while the `core-purity` guard knew five Node globals. The maintainer chose a runtime-neutral environment on 2026-10-12: [ADR-018](docs/adr/0018-core-type-checks-against-the-web-platform.md). `src` type-checks against `lib` es2024 + webworker with no `types`, the tests and configs have their own `tsconfig` with Node, every test runs in Node and in `core:workerd`, and `core-purity` checks all three

### Wave 0 (orchestrator): what the parallel work stands on

Every item is done, verified and committed by the orchestrator before Wave 1. Afterwards the files of Wave 0 are frozen: a WP that needs a change asks the orchestrator.

- [ ] 0.1 ADRs written with this plan: 019 (personal tokens in v0.1, OAuth in v0.3) and 020 (content safety). Written in Wave 0, before the WPs that build on them: 021 (append-only revisions, conditional child rows, `publications`), 022 (conformance baseline policy) and 023 (fix-forward migrations and the shipped `0000_init.sql`)
- [ ] 0.2 One install of the stage's dependencies, all at least 24 hours old: hono 5.0.0-rc.1, `@modelcontextprotocol/server` and `client` 2.3.1, `@modelcontextprotocol/conformance` 0.2.0-alpha.12, zod 4.6.5 (the copy the lockfile already has), comark and `@comark/html` 0.7.0, drizzle-orm 0.45.4, drizzle-kit 0.31.11, `@standard-schema/spec` 1.1.0. The OAuth provider and SimpleWebAuthn wait for v0.3. `zod` is a peer dependency of `core` (`^4.2.0`), and `catalog-deps` allows a range in `peerDependencies` only
- [ ] 0.3 Runtime flags: `no_nodejs_compat`, `no_nodejs_compat_v2` and `send_metrics: false` in every Wrangler config (playground and its site, starter, examples). A guard binds them, with its line in `tests/AGENTS.md`. A test-only probe route answers `typeof globalThis.process` on the built playground; CI sets `WRANGLER_SEND_METRICS=false`
- [ ] 0.4 `packages/server` as a Workers package:
  - a Wrangler config for its tests (D1 binding, the flags of 0.3);
  - runtime types generated by `wrangler types`, and `src` type-checked with them and without Node's types;
  - `tests/tsconfig.json`, `vitest.workerd.config.ts` (`server:workerd`), and the `build` and `types:check` scripts that `worker-projects` requires
- [ ] 0.5 Interfaces that compile, with no logic:
  - `core/src/config`: `defineConfig` (exactly one site per deployment in v0.1), `defineCollection`, `defineComponent`, `defineContract`. A collection holds `schema` (Standard Schema with JSON Schema), routes per locale, `translations.groupBy`, `components` (strict prop schemas), `contracts`, `maxMarkdownBytes` (default 512 KiB) and `styleGuide`
  - `core/src/markdown`: `processMarkdown()` returns frontmatter, document, extracted data (headings, classified links, images, components, words, and markers for disallowed content), `comarkVersion` and `pipelineVersion`; `renderHtml()` renders a stored document
  - `core/src/contracts`: `Violation {contract, severity, path (JSON Pointer), message, fix, line?}`, `Verdict` (ok, errors, warnings, phase `write` or `publish`, `contractsHash`), `Contract`, and the `EntryLookup` port with `lookupMany` in chunks
  - `core/src/operations`: the nine specs (`describe_site`, `list_entries`, `get_entry`, `get_translations`, `create_draft`, `update_draft`, `validate`, `publish`, `unpublish`) with Zod input and output, scopes and effect. The outcome table below is pinned there in code
  - `core/src/tokens`: the personal token format (`hw_pat_` prefix, SHA-256 hash, `tok_` id, scopes, expiry), shared by `server`, which checks tokens, and the CLI, which makes them
  - `server/src`: `ports.ts`, `db/schema.ts`, `db/columns.ts`, the handler type and the typed pairing of specs and handlers (ADR-017), and `index.ts` with `createHollware(config) → {fetch, Hollware}`
- [ ] 0.6 The database baseline:
  - the Drizzle schema of v0.1;
  - drizzle-kit seeded from the shipped `0000_init.sql`, then `0001_*` generated and `0002_*` with the append-only triggers written by hand;
  - `migrations.lock.json` with the sha256 of every shipped migration, and its test;
  - the schema guard (`site_id`, timestamps, composite keys; `_hollware_meta` as a reasoned exception);
  - the trigger guard, which lists them after all migrations and tries `INSERT OR REPLACE` on every unique key of `revisions`;
  - a CI step: `drizzle-kit generate` yields no diff
- [ ] 0.7 Test support:
  - synthetic fixtures: bilingual posts, one of 2,027 words, hostile Markdown, and rows of a second site;
  - a loader through Vite (`import.meta.glob` with `?raw`) that works in Node and in workerd;
  - `fmt.ignorePatterns` for the fixtures;
  - `packages/core/bench/` outside `src`;
  - one harness pattern: requests to `http://hollware.test` with `HOLLWARE_PUBLIC_URL` set to it;
  - a bilingual blog config in `apps/playground/hollware.config.ts`
- [ ] 0.8 Root tasks and CI steps: each lands with the first test it runs (`test:conformance` with WP10, `check:budgets` with WP11, `test:acceptance` in Wave 4), so the guard `test-projects` never sees a test that nothing runs

### Operations: outcomes and effects (pinned in `core/src/operations`)

| Operation          | Effect      | Outcomes                                                                 | `isError` outcomes                 |
| ------------------ | ----------- | ------------------------------------------------------------------------ | ---------------------------------- |
| `describe_site`    | read        | `ok`                                                                     | —                                  |
| `list_entries`     | read        | `ok` (keyset cursor)                                                     | —                                  |
| `get_entry`        | read        | `ok`, `not_found`; `view: head` (MCP) or `published` (RPC)               | `not_found`                        |
| `get_translations` | read        | `ok`, `not_found`                                                        | `not_found`                        |
| `create_draft`     | write       | `saved` (verdict may hold errors), `refused`                             | `refused`                          |
| `update_draft`     | edit        | `saved`, `unchanged`, `conflict`, `not_found`, `refused`                 | `conflict`, `not_found`, `refused` |
| `validate`         | read        | `ok` (verdict; the version does not change)                              | —                                  |
| `publish`          | write       | `published`, `blocked`, `needs_acknowledgement`, `conflict`, `not_found` | `blocked`, `conflict`, `not_found` |
| `unpublish`        | destructive | `unpublished`, `not_found`                                               | `not_found`                        |

- `refused` is kept for content that cannot be stored or listed: a `size-limit` breach, or frontmatter that does not parse. Every other error is saved with the draft and only blocks publishing (ADR-004, ADR-020).
- Hints from the effect: `read` is read-only and idempotent; `edit` and `write` are neither read-only nor destructive; `destructive` is destructive. Every tool is closed-world (`openWorldHint: false`).
- An answer over the output cap is the error `output_too_large`, never truncated content. Every call has a timeout and one log line with its `requestId`.
- The HTTP equivalents follow the same table when the HTTP API arrives in v0.2. RPC exposes `getEntry` (published view), `listEntries`, `getTranslations` and `describeSite`, and nothing that writes.

### Data model and rules

- `columns.ts`: `id(prefix)` (prefixed ULIDs: `ent_`, `rev_`, `usr_`, `tok_`, `pub_`…), UTC `created_at`/`updated_at` with `$onUpdate`; every table uses it and only repository functions write
- `site_id` on every table, children included, with `UNIQUE(id, site_id)` and composite foreign keys; `CHECK` lists include the values the design already plans (`scheduled` for v0.2); one site per deployment in v0.1, and a site key that leaves the config is reported at startup
- `entries`: `version` (bumped by every mutation), `head_rev`, `published_rev`, `published_at`, `published_sort_key`, `UNIQUE(site_id, collection, translation_group, locale)`, a partial index for published listings
- `revisions`: the whole file as Markdown (a byte-identical export) and the derived columns that `reparse` may rewrite (`document`, `comark_version`, `pipeline_version`, `word_count`); three triggers keep it append-only across every unique key; `revision_tags` as a child table
- `publications` (append-only): entry, revision, the verdict of the publish phase, the acknowledged warnings, the actor (user and token) and the time
- `users` (the owner in v0.1) and `tokens` (hash, `site_id`, scopes, expiry with a default of 90 days, revocation, `last_used_at` written at most once an hour). Passkeys, setup links and challenges come with v0.3
- Optimistic write, one `db.batch`: `INSERT INTO revisions … SELECT … WHERE version = ?`, then child rows `INSERT … SELECT … WHERE EXISTS` their revision, then `UPDATE entries … WHERE version = ? RETURNING version`. An empty `RETURNING` is followed by one read that tells `conflict` from `not_found`. D1 runs a batch as one transaction, and `db.transaction()` is not available
- D1 limits, enforced in code: at most 100 bound parameters per statement (lookups and multi-row inserts in chunks of 90), statements under 100 KB (the Markdown is always bound), rows under 2 MB counted in UTF-8 bytes across all columns before writing (Miniflare does not enforce it), and the 50 queries per invocation of the Free plan
- Reads: MCP reads the primary; RPC reads through `withSession('first-unconstrained')` with the typed session adapter from the spike
- Publish runs the contracts in the `publish` phase: errors → `blocked`; unacknowledged warnings → `needs_acknowledgement`, answered with MRTR by 2026 clients that declare elicitation and with `acknowledgeWarnings` by every client; the `publications` row records what was acknowledged
- Content safety (ADR-020): raw HTML, unknown components, disallowed attributes and unsafe URLs are contract errors with a fix; the parser runs with `autoClose: false`, without the `html` plugin, with `tagFallback` markers and an allowlist of attributes per tag, memoized per isolate and tag set; heading ids are Hollware's own; checks before parsing (a string, BOM removed, `maxMarkdownBytes`; `RangeError` and `YAMLException` become violations)
- Auth (ADR-019): personal tokens only; effective scopes are the token's scopes intersected with the owner role; a missing scope is `403 insufficient_scope` naming every scope the operation needs; the Host and Origin guard fails closed
- MCP: `tools/list` sorted by name, the same for every client, `listChanged: false`, a cache hint, schemas converted once per isolate; scopes checked at call time; `HollwareError {code, message, fix, internal cause}`
- CLI (never loads `hollware.config.ts`):
  - `init` creates the site, the owner and a first token printed once, and refuses when an owner exists;
  - `migrate` has `--check`, and backs up before `--remote`;
  - `token create|list|revoke` use fixed SQL templates with validated values;
  - `import` reads the token from `--token-file` or stdin, validates everything before writing, and is idempotent through `unchanged`

### Waves

Every WP ships integration tests that are green in its own wave, owns disjoint directories, and is verified by the orchestrator with at least one `break-line` mutation per invariant it adds.

- [ ] Wave 1 (parallel):
  - WP1 config (`core/src/config`);
  - WP2 Markdown and content safety (`core/src/markdown`, `core/bench`);
  - WP3 contracts, including content safety and `size-limit` (`core/src/contracts`);
  - WP4 the D1 store on the schema of Wave 0 (`server/src/db`): repository functions, the optimistic write, sessions, limits;
  - WP5 auth (`server/src/auth`): token check, scopes, the Host and Origin guard;
  - WP6 CLI (`packages/cli`)
- [ ] Wave 2 (parallel): WP7 operation handlers (`server/src/ops`) · WP8 MCP adapter (`server/src/mcp`), tested against fake handlers of the Wave 0 types
- [ ] Wave 3a: WP9 composition (`server/src/{http,rpc}` and `index.ts`): the gateway, the MCP route, the RPC entrypoint, `createHollware`
- [ ] Wave 3b (parallel):
  - WP11 playground, starter and `examples/worker-site`, with minified builds and the parser imported lazily on writes; `scripts/check-budgets.ts`;
  - WP10 conformance (`tests/conformance`): the proxy that adds a token, the baselines of ADR-022 and the task `test:conformance`
- [ ] Wave 4: the acceptance suite `tests/acceptance/v0.1` with its task, runner and CI step in one commit (orchestrator); fixes go back to the owning WP; three reviewers; close (ADR-006 and ADR-009 confirmed or revised, README status)

### Acceptance criteria (`tests/acceptance/v0.1/`, over the built playground and `examples/worker-site`)

| #         | Criterion                      | Verification                                                                                                                                                                                                                                                                                                                                                                                                    |
| --------- | ------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| AC-0.1-1  | Static checks and build        | `vp run check:push` (check, test, build, bins, publint, types)                                                                                                                                                                                                                                                                                                                                                  |
| AC-0.1-2  | Unit and integration           | `vp test`, with the workerd projects of `core`, `server` and the playground                                                                                                                                                                                                                                                                                                                                     |
| AC-0.1-3  | Agent flow, 2026 era           | `describe_site` (schema, style guide) → invalid `create_draft`: `saved`, version 1, errors with fixes → `publish`: `blocked` → fixed `update_draft`: `saved`, version 2 → `update_draft` at version 1: `conflict` with `currentVersion` 2, `head_rev` unchanged → `validate`: version still 2 → `publish` with a warning: MRTR elicitation accepted → `published`; `get_entry` returns the acknowledged warning |
| AC-0.1-4  | Agent flow without MRTR        | the same writes from a 2025 client and from a 2026 client without elicitation: `publish` → `needs_acknowledgement` → `publish` with `acknowledgeWarnings` → `published`                                                                                                                                                                                                                                         |
| AC-0.1-5  | RPC from another Worker        | `examples/worker-site` serves the published HTML from the stored document; a draft's path is 404; `listEntries` by tag over two cursor pages; `getTranslations` returns the ES/EN pair; after `unpublish` the page is 404; the binding has no write method                                                                                                                                                      |
| AC-0.1-6  | Auth                           | no token, unknown, expired or revoked token → 401; a `content:read` token on `create_draft` → 403 naming `content:write`; a foreign Host → 403; a foreign Origin → 403; no `HOLLWARE_PUBLIC_URL` → 500                                                                                                                                                                                                          |
| AC-0.1-7  | MCP conformance                | `vp run test:conformance` (through the token proxy, against `wrangler dev` of the build) with `--requirements 2026-07-28` and `2025-11-25` → exit 0; the must-pass scenarios (initialize or discover, tools-list, json-schema-2020-12, header validation, DNS rebinding protection, caching of `tools/list`, wire schema) have no baseline entry                                                                |
| AC-0.1-8  | Budgets                        | the built playground Worker, minified and gzipped, stays under the ceiling of `budgets.json` (fixed before measuring; hard); startup (median of five) and CPU per write of the 2,027-word fixture, cold and warm, are logged                                                                                                                                                                                    |
| AC-0.1-9  | Import                         | the synthetic corpus (10 entries, 5 translation groups, tags) is created; a second run answers `unchanged` for every entry, and no version moves                                                                                                                                                                                                                                                                |
| AC-0.1-10 | Migrations                     | `hollware migrate` from empty applies all; a second run is a no-op; `migrate --check` lists pending ones; the lock test fails on a changed or missing shipped migration; the triggers exist after all migrations; `drizzle-kit generate` yields no diff                                                                                                                                                         |
| AC-0.1-11 | Clean clone and packed install | a clean clone runs `pnpm install --frozen-lockfile`, `vp run check:push`, `vp run test:acceptance`, `vp run test:conformance` and `vp run check:budgets`; the six packed tarballs installed into an empty project with zod leave one copy of zod                                                                                                                                                                |
| AC-0.1-12 | Tests can fail                 | `break-line`, each mutation turning the named AC red: the version predicate (3), the publish gate (3), the scope check (6), the token revocation check (6), the Host guard (6), the RPC read-only surface (5), the `site_id` predicate (13), the content-safety contract (14), the Node.js opt-out flags (15)                                                                                                   |
| AC-0.1-13 | Site isolation                 | with rows of a second site in the database, every operation and RPC method called with the other site's ids answers `not_found`                                                                                                                                                                                                                                                                                 |
| AC-0.1-14 | Content safety                 | a draft with raw HTML, `::youtub`, a disallowed attribute and a `javascript:` link is saved with one error for each, every one with a fix; `publish` → `blocked`; the stored Markdown is unchanged; a published entry's HTML holds no raw HTML                                                                                                                                                                  |
| AC-0.1-15 | No Node.js                     | the built playground answers the probe with `typeof process` `undefined`, and AC-0.1-3 runs against that build                                                                                                                                                                                                                                                                                                  |
| AC-0.1-16 | CLI                            | `hollware init` on an empty local D1 creates the site, the owner and a token printed once; a second `init` is refused; `token create`, `list` and `revoke`, and the revoked token gets 401                                                                                                                                                                                                                      |
| AC-0.1-17 | Release 0.1.0                  | published through the pipeline with provenance, after the maintainer action on the agents' credentials is closed, with the maintainer's approval of the `npm` environment                                                                                                                                                                                                                                       |

New ADRs: 016 workspace packages resolve to their source · 017 operation specs in `core`, handlers in `server` · 018 `core`'s type environment · 019 personal tokens in v0.1, OAuth and passkeys with the admin · 020 content safety is a contract (all accepted) · 021 append-only revisions, conditional child rows and `publications` · 022 conformance baseline policy · 023 fix-forward migrations and the shipped `0000_init.sql`.

### Verification log

- 2026-10-12 — Workspace resolution, in a scratch clone of `70028e4` where `server` imports `core` and the playground Worker imports `server`:
  - Today, without `dist`: `vp check` fails with TS2307 (`Cannot find module '@hollware/core'`); the `server` tests and the three `playground:workerd` files fail with `Failed to resolve entry for package`.
  - With tsdown's `exports.devExports: true` (shipped in vite-plus 1.1.0), `vp pack` writes `exports` pointing at `./src/index.ts` and `publishConfig.exports` (and `publishConfig.bin` for the CLI) pointing at `dist`. With every `dist` deleted, `vp check` passes, the `server` tests pass (2) and `playground:workerd` passes (8). The playground builds and `wrangler deploy --dry-run` reports 1.28 KiB, with `core` bundled from source.
  - A cross-package type error (`core`'s `name` turned into a number) fails `vp check` with TS2322 in `server`. Under `vp dev`, an edit to `core/src` reaches the running Worker through HMR, with no `dist`.
  - Publishing is unchanged: `pnpm pack`, the real `changeset pack` the release action runs, and `publint --strict` (which packs with pnpm) all produce `exports` (and `bin`) pointing at `dist`, with `publishConfig` holding only `access` and `provenance`, so the `publish` job's tarball check still passes. `server` gets `@hollware/core` as `0.0.2`, not `workspace:*`. A rebuild leaves the formatted manifests byte-identical.
  - The manifests guard fails on the new shape, as expected. `scripts/check-bins.ts` reads `bin`, so it would silently run the source bin (Node 24 strips the types) instead of the built one: it has to read `publishConfig.bin` first.
- 2026-10-12 — ADR-016 applied to the repository:
  - The six packages build with `devExports`, and `vp pack` rewrote their manifests. The guard `manifests` pins the new shape and reads `pack.exports.devExports` from each package's real `vite.config.ts` (16 tests). The new guard `build-order` pins the order of `check:push` (5 tests). `check-bins` runs `publishConfig.bin`, and a test fails if it runs the source bin. The `publish` job's test refuses a tarball that still holds `publishConfig.exports`. An empty changeset covers the package change: the published manifests do not move.
  - With every `dist` deleted, `vp run check:push` exits 0: 55 files and 575 tests, both published bins answer `--version`, `publint --strict` is clean ×6, types up to date. The build leaves the manifests byte-identical.
  - Orchestrator mutations → CAUGHT by the test that names the line: `devExports: false` in `core`'s config (`manifests`), `check-bins` reading `bin` (`check-bins`), `check:push` building before `vp test` (`build-order`), and the `publish` job letting `publishConfig.exports` through (`verify-and-publish`).
  - CI green on `18758b4` (CI, Release, Security, CodeQL). On `main`, `select-mode` skipped the Version Packages pull request: an empty changeset releases nothing.
- 2026-10-12 — Node.js compatibility, checked by the orchestrator: wrangler 4.149.0 turns `nodejs_compat` and `nodejs_compat_v2` on for compatibility dates from 2026-08-04 (`NODEJS_COMPAT_DEFAULT_ON_DATE`; Cloudflare's docs agree). A probe Worker under `wrangler dev`: date 2026-10-06 without flags has `process`, `Buffer` and `setImmediate`; with `no_nodejs_compat` + `no_nodejs_compat_v2`, or with date 2026-08-03, none. `@cloudflare/vitest-plugin` 1.4.0 adds `nodejs_compat_v2` to the test runner whatever the config says.
- 2026-10-12 — Spikes. Each ran in its own scratch clone with installed dependencies (hono 5.0.0-rc.1, `@modelcontextprotocol/server`/`client` 2.3.1, conformance 0.2.0-alpha.12, zod 4.6.5, comark/`@comark/html` 0.7.0, drizzle-orm 0.45.4, drizzle-kit 0.31.11, `@simplewebauthn/server` 14.0.3, `@cloudflare/workers-oauth-provider` 1.2.3). The orchestrator re-ran every suite and probed with `break-line`; every mutation was CAUGHT by the test that names it:
  - S1/S2/S8: 87 tests (13 more run against a built Worker); the built Worker with both opt-outs answers `process: "undefined"` and an MCP `tools/call`, and the 6 HTTP tests pass against it. Mutations: Host guard bypassed, error handler falling back to a text 500. Sizes: Hono only 44 KB / 12 KB gzip; Hono + MCP + zod 793 KB / 186 KB gzip (minified 329 / 87), startup ~20 ms active. Conformance on the stub: 2026-07-28 99 checks passed / 70 failed, 2025-11-25 35 / 26, all from unimplemented capabilities or missing `test_*` tools, 0 wire-schema failures.
  - S3: 210 tests; the built Worker with both opt-outs parses and renders. A probe confirms `<script>` passes through by default, `# Diseño del planificador` gets the id `diseo-del-planificador`, and 5,000 `*a ` throw `RangeError` unless `autoClose: false`. Mutation: the safe parser with the default plugins. CPU in Node 24: warm 0.50 ms parse + render for 2,000 words, 2.4 ms for 10,000; cold write path ~10 ms for 2,000 words. Parse + render Worker 572 KB / 159 KB gzip (minified 287 / 110); render only, minified, 31.5 KB gzip.
  - S4: 76 tests. Mutations: version predicate dropped, the anti-`REPLACE` trigger disabled. Worker with drizzle 177 KiB / 34 KiB gzip.
  - S5: 61 tests; the built Worker with both opt-outs runs a full ceremony (`node:crypto` not importable). The library mutates a module-level `authenticatorSelection` default and leaves `expectedRPID` optional for registration (both read in its code). Mutation: ECDSA signature sent raw instead of DER. 617 KB / 125 KB gzip, minified 287 / 78; verify 0.03 ms (registration) and 0.10 ms (authentication) in Node.
  - OAuth: 104 tests across both topologies. Mutation: an expired personal token accepted. The hook names were read in `dist/oauth-provider.d.ts`, the single-resource `TypeError` in `dist/oauth-provider.js`. Provider + Hono minified 136 KiB / 38.6 KiB gzip.
  - The sub-agents ran wrangler with its default telemetry until about 15:22 (-03); from then on, and in every orchestrator run, `WRANGLER_SEND_METRICS=false`.
- 2026-10-12 — ADR-017 recorded and the documents aligned: the design (four places), ADR-003, the README table, `AGENTS.md`, the READMEs, `AGENTS.md` files and descriptions of `core` and `server`. An empty changeset covers the descriptions. `vp check` and the `repo` guards pass (43 files, 532 tests), the ADR guard with 18 files. CI green on `64a3a9d`.
- 2026-10-12 — ADR-018 applied:
  - In a scratch clone, a probe in `core/src` showed that `types: []` alone changes nothing (the tests and `vite.config.ts` in the same program pull Node's types in through Vite+), and that a program of `src` alone with `lib` es2024 + webworker and `types: []` accepts `TextEncoder`, `URL`, `crypto.subtle` and `structuredClone` and rejects `setImmediate`, `global`, `document`, `window` and `localStorage`.
  - In the repository, `break-line` with `vp check` as the command: `setImmediate` in `core/src` → CAUGHT; `document.title` → CAUGHT; `TextEncoder`/`TextDecoder` → NOT CAUGHT, as intended; a type error in `vitest.workerd.config.ts` → CAUGHT, so the configs are still type-checked.
  - `vp test list` puts `packages/core/tests/index.test.ts` in `@hollware/core` and in `core:workerd`; both runs pass. The guard `core-purity` has 11 tests (repository check and self-tests for the `tsconfig`, a `tsconfig` with comments or broken, and the two runtimes).
  - Orchestrator mutations on the guard → CAUGHT by its repository test: `"types": ["node"]` back in `core`'s `tsconfig.json`, and the `packages/*/vitest.*.config.ts` projects dropped from the root config.
  - With every `dist` deleted, `vp run check:push` exits 0: 56 files and 579 tests, both bins, `publint --strict` ×6, types up to date.

---

## Later stages (detailed at the start of each stage)

- **v0.2 Publishing** — publish Workflow tracked as an MCP Task + scheduling; outbox → Queue → HMAC webhooks, IndexNow, custom subscribers, DLQ; revision diff, restore and trash (`delete_entry`/`restore_entry`); media in R2 + Images; FTS5 search; HTTP API + OpenAPI 3.1 + ETag + Workers Cache + purge; `@hollware/client` (binding or HTTP); `export`, `reparse`, `reindex`, cron backups; `audit_log`; optional write-time highlighting. **Exit:** on the demo (`demo.hollware.com`), publish over MCP is live in < 60 s with no CI.
- **v0.3 Admin** — Vue 3.5 + Nuxt UI 4 + Vue Router 5 SPA shipped in `@hollware/admin`; PKCE first-party client; editor (CodeMirror 6 + Comark preview), contract-driven forms, review queue with diff, approval via Workflow `waitForEvent`; identity screens. **Exit:** an agent's post approved from the admin; axe clean.
- **v0.4 Distribution** — `create-hollware` + starter + `hollware deploy`/`doctor`; read tokens and site isolation; Docus docs on hollware.com written in Hollware; `@hollware/nuxt`. **Exit:** a docs-only sub-agent and an external person install Hollware from the docs.
- **v0.5 Intelligence** — embeddings (Workers AI + Vectorize), semantic/hybrid search, related entries, Analytics Engine + `content_stats`, `@hollware/agents` (Agents SDK, never `content:publish`). **Exit:** an agent picks what to update from metrics and publishes it through the contracts.
- **v1.0 Stable** — stability ADR, API guards (oasdiff, api-extractor, publint, attw, migrations lock), `cf`/Drizzle v1 if GA, importers, security review, `@hollware/astro`, `@hollware/next`. **Exit:** hollware.com + the demo + at least one external site in production; this file is deleted.

Out of scope for this plan: migrating sergioazocar.com. It happens after v1.0 with its own plan in that repository.
