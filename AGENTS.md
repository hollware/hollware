# AGENTS.md

Hollware is an open-source headless CMS for the agent era, native to Cloudflare
Workers. Agents write Markdown through MCP, contracts validate every write, D1 is
the single source of truth, and sites read published content over Workers RPC.
The design is in `docs/design.md` and every structural decision is an ADR in
`docs/adr/`.

This file orients. Rules live in tests, lint rules or types: if a test could hold
a claim, the claim belongs in a test.

## Work in progress

`PLAN.md` tracks the roadmap while it is being built. Mark an item `[x]` only
after it is verified, and record the evidence in its verification log. The file is
deleted when v1.0 ships, together with this section.

## Commands

| Command                                                                   | What it does                                                    |
| ------------------------------------------------------------------------- | --------------------------------------------------------------- |
| `pnpm install`                                                            | Install dependencies (pnpm version comes from `packageManager`) |
| `vp check`                                                                | Format, lint and type-check the whole repo                      |
| `vp test`                                                                 | Run every test project; `vp test --project <name>` runs one     |
| `vp run -r build`                                                         | Build every package                                             |
| `vp run check:push`                                                       | Everything CI runs: check, test, build, publint, types          |
| `node scripts/break-line.ts --file <f> --find <s> --replace <s> -- <cmd>` | Mutation probe: prints `CAUGHT`, `NOT CAUGHT` or `ERROR`        |

Always run the project-local `vp` (through `pnpm exec` or package scripts). A
global `vp` of another version breaks the Cloudflare plugin. Supervised servers are
started with their local binary, never with `pnpm dev`: pnpm 12 runs scripts in a
new process group, so the child outlives its supervisor.

## Workers in this repo

- The playground has two test projects: `playground:workerd` (inside workerd, through
  `@cloudflare/vitest-plugin`) and `playground:harness` (Node, through wrangler's
  `createTestHarness` over the Vite build). Run both with
  `pnpm --filter @hollware/playground run test`.
- Tests that import from `vitest` or `cloudflare:test` are named `*.workerd.test.ts`.
- Keep `fsModuleCache: false` in workerd test configs: with `true`, Vitest 5 and
  `@cloudflare/vitest-plugin` fail to read their module cache (workers-sdk#15618).
- `vp dev` starts through a launcher: stopping the launcher leaves the dev server and
  workerd running. Stop the process that listens on the port instead.
- `compatibility_date` must not be newer than the workerd that wrangler bundles.

## Layout

- `packages/core` — contracts, schemas, Markdown pipeline. No Cloudflare imports.
- `packages/server` — the Worker: operations, MCP, RPC, HTTP, auth, D1 migrations.
- `packages/client` — the same interface over a service binding or HTTP.
- `packages/admin` — the review and approval UI, prebuilt.
- `packages/cli` — the `hollware` CLI.
- `packages/create-hollware` — `npm create hollware`.
- `apps/playground` — a local Hollware instance for development.
- `templates/starter` — the thin project users get.
- `examples/` — sites that consume Hollware.

## Conventions

- Everything in the repository is written in English.
- Conventional Commits. A change that touches a published package carries a
  changeset (`pnpm exec changeset`).
- There is no `CLAUDE.md` and there must never be one: agents read this file.
- Dependencies come from the pnpm catalog in `pnpm-workspace.yaml`: exact versions,
  published at least 24 hours before they are pinned. Never lower
  `minimumReleaseAge`; an urgent fix gets an exact `minimumReleaseAgeExclude` entry
  with a reason and an expiry date.
- Every bare import is declared in the importing package's `package.json`.
- Packages never read `process.env`; configuration arrives as arguments.
- A promise is always awaited or explicitly handled: Workers cancel the rest.

## Test bar

- For every test, name the production line that must change for it to fail. If
  you can't, the test is tautological: strengthen it or delete it.
- Expected values are literals or worked examples, never recomputed the way the
  code computes them.
- An assertion that only checks `toBeDefined()` or `toBeTruthy()` is not a test.
- Mock only what you don't own. Your own modules and the database stay real (D1
  runs in Miniflare).
- Two tests killed by the same mutation are one test.
- There is no coverage threshold. Mutations are the measure: break the line with
  `scripts/break-line.ts` and expect `CAUGHT`.

## Verification surface

Every invariant this repository claims about itself is bound to a mechanism that
fails when the claim stops being true. When a change adds a source of truth, an
invariant or a convention, bind it to a test, a lint rule or a type in the same
change, and mention it here. Never weaken or delete a guard to make a change pass.

## Guards

What each guard binds. A guard is a pure function in `tests/guards/<name>.ts`; its test runs it on
this repository (no violation) and on a bad fixture (the exact violation). Facts of the repository
live in `tests/conventions/`, claims about docs and tests in `tests/meta/`. Exceptions live only in
`tests/guards/exceptions.ts`, each with a reason, and a list may only shrink. A new guard adds its
line here. Run them with `pnpm exec vp test --project repo`. After `vp run -r build`,
`node scripts/check-bins.ts` runs each built bin with `--version`.

- `tests/conventions/manifests.test.ts`: the six packages share one manifest shape and version; apps and templates are private.
- `tests/conventions/licenses.test.ts`: every package `LICENSE` is a byte copy of the root MIT one.
- `tests/conventions/no-claude-md.test.ts`: no `CLAUDE.md` anywhere, tracked or not.
- `tests/conventions/core-purity.test.ts`: `packages/core` has no Cloudflare or Node import, no Node global, no Cloudflare dependency.
- `tests/conventions/declared-imports.test.ts`: every bare import is declared by the package that makes it.
- `tests/conventions/catalog-deps.test.ts`: every dependency is `catalog:` or `workspace:*`.
- `tests/conventions/changesets.test.ts`: `fixed` is one group, the published packages; public access.
- `tests/conventions/pnpm-policy.test.ts`: release age, trust policy, reasoned builds and excludes, exact catalog.
- `tests/conventions/wrangler-dates.test.ts`: no `compatibility_date` newer than the bundled workerd.
- `tests/conventions/workflow-pinning.test.ts`: every action is a commit SHA with its `# vX.Y.Z`.
- `tests/conventions/workflow-permissions.test.ts`: `permissions: {}`, `id-token: write` in two jobs, no kept credentials, Scorecard rules.
- `tests/conventions/workflow-forbidden.test.ts`: no npm token, direct publish, `git push`, `npx` or `dlx`; zizmor ignores allowlisted.
- `tests/conventions/release-workflow.test.ts`: release jobs gated to this repository and `main`; `stage` isolated.
- `tests/conventions/setup-vp-version.test.ts`: `setup-vp` pins the catalog `vite-plus`; Node comes from `.node-version`.
- `tests/conventions/adr.test.ts`: ADR names, numbers, status and sections; the index and design table match the files.
- `tests/conventions/issue-forms.test.ts`: the issue forms are valid for GitHub and ask what `CONTRIBUTING.md` says.
- `tests/conventions/advisory-url.test.ts`: one private vulnerability reporting address across the docs.
- `tests/conventions/principles.test.ts`: the README principles are the feature request dropdown options.
- `tests/conventions/code-of-conduct.test.ts`: no template placeholder, one contact address.
- `tests/conventions/personal-email.test.ts`: no personal email address in any file.
- `tests/conventions/admin-isolation.test.ts`: no code outside `packages/admin` imports `@hollware/admin`.
- `tests/conventions/workerd-tests.test.ts`: `*.workerd.test.ts` is the name of tests importing `vitest` or `cloudflare:*`; no `fsModuleCache: true`.
- `tests/meta/agents-paths.test.ts`: backticked paths in `AGENTS.md` and `README.md` files exist.
- `tests/meta/agents-commands.test.ts`: the `vp run`, `pnpm --filter` and `node` commands `AGENTS.md` cites exist.
- `tests/meta/markdown-links.test.ts`: relative links and anchors in every Markdown file lead somewhere.
- `tests/meta/package-lists.test.ts`: Layout, README table and changeset README list the real packages.
- `tests/meta/agents-size.test.ts`: every `AGENTS.md` stays within 12,000 characters.
- `tests/meta/test-projects.test.ts`: every test file belongs to a project that `vp test` lists.
- `tests/meta/contributing.test.ts`: `CONTRIBUTING.md` agrees on Node.js, pnpm and the commands table.
- `tests/meta/exceptions.test.ts`: exception lists keep their recorded size; none lives outside the registry file.
- `tests/meta/patches.test.ts`: a dependency patch starts with `PATCHED (reason)` and a test mentions it.
- `tests/meta/guards-registry.test.ts`: every guard file is cited here, once, with what it binds.
- `tests/meta/self-tests.test.ts`: every guard is run by a test with a `self-test` block feeding it a bad fixture.
- `tests/meta/scanners.test.ts`: the JSONC, Markdown, source and workspace readers the guards stand on.

## Updating dependencies

1. Check what is outdated with `pnpm outdated -r`.
2. Pick versions published more than 24 hours ago and update the catalog.
3. Run `pnpm install`, then `vp run check:push`.
4. Read the changelogs of anything in a 0.x or release-candidate line before
   committing, and record notable changes in the commit message.
