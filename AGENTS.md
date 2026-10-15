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

| Command                                                                   | What it does                                                                                                      |
| ------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| `pnpm install`                                                            | Install dependencies (pnpm version comes from `packageManager`)                                                   |
| `vp check`                                                                | Format, lint and type-check the whole repo                                                                        |
| `vp test`                                                                 | Run every test project; `vp test --project <name>` runs one                                                       |
| `vp run -r build`                                                         | Build every package                                                                                               |
| `vp run bench`                                                            | Benchmark the Markdown pipeline: fails when a write takes over 3 ms of CPU at p95                                 |
| `vp run check:budgets`                                                    | Fails when the built Worker is over a ceiling of `budgets.json`; logs its startup                                 |
| `vp run check:push`                                                       | The CI check job: check, test, bench, build, budgets, publint, types                                              |
| `vp run test:conformance`                                                 | MCP conformance (ADR-022): the suite against `wrangler dev`, for both revisions                                   |
| `vp run test:acceptance`                                                  | The acceptance suite of the stage, against the built playground and example site                                  |
| `vp run e2e:admin`                                                        | The admin in Chromium with a virtual passkey and axe (`pnpm exec playwright install chromium` once)               |
| `vp run e2e:install`                                                      | `create-hollware` from a local registry of this checkout, then MCP, publish and a read token (`-- --pm pnpm` too) |
| `vp run e2e:upgrade`                                                      | A project of 0.3.0, installed from npm, moved to this checkout and migrated; its data and token still work        |
| `node scripts/break-line.ts --file <f> --find <s> --replace <s> -- <cmd>` | Mutation probe: prints `CAUGHT`, `NOT CAUGHT` or `ERROR`                                                          |

Always run the project-local `vp` (through `pnpm exec` or package scripts). A
global `vp` of another version breaks the Cloudflare plugin. Supervised servers are
started with their local binary, never with `pnpm dev`: pnpm 12 runs scripts in a
new process group, so the child outlives its supervisor.

## Workers in this repo

- The playground is a Hollware project (`apps/playground/src/index.ts` is `createHollware(config)`),
  and `examples/worker-site` is the site that reads it over a service binding. The playground has
  two test projects: `playground:workerd` (inside workerd, through `@cloudflare/vitest-plugin`) and
  `playground:harness` (Node, through wrangler's `createTestHarness` over the Vite builds of both
  Workers). Run both with `pnpm --filter @hollware/playground run test`.
- The tests of `packages/core` run in Node and again inside workerd (`core:workerd`), and
  its `src` type-checks against the web platform only (ADR-018).
- Tests that import from `vitest` or `cloudflare:test` are named `*.workerd.test.ts`.
- Keep `fsModuleCache: false` in workerd test configs: with `true`, Vitest 5 and
  `@cloudflare/vitest-plugin` fail to read their module cache (workers-sdk#15618).
- `vp dev` starts through a launcher: stopping the launcher leaves the dev server and
  workerd running. Stop the process that listens on the port instead.
- `compatibility_date` must not be newer than the workerd that wrangler bundles.
- Workers turn Node.js compatibility on by default from the 2026-08-04 compatibility date.
  Every `wrangler.jsonc` here opts out with `no_nodejs_compat` and `no_nodejs_compat_v2`,
  and Hollware's own set `send_metrics: false`.
- The test runner of `@cloudflare/vitest-plugin` keeps Node.js compatibility on whatever
  the flags say, so a workerd test never proves that code runs without Node.js. The
  playground's harness test proves it on the built Workers.
- Harness tests reach Hollware at `http://localhost` and give the Worker that URL as
  its `HOLLWARE_PUBLIC_URL`: the harness hands a Worker every URL as `http`, and the OAuth
  server takes `http` only on a loopback host. Build the harness with `createPlaygroundHarness()`
  from `apps/playground/test/harness/workers.ts`. Hollware is its primary Worker, so
  `server.fetch('http://localhost/...')` carries the Host its guard compares; a request sent
  straight to a Worker (`server.getWorker(name).fetch`) carries the harness's own Host, so only the
  site is reached that way (`siteFetch`). Content is created as an agent creates it, through
  `agentWith(...)` and MCP; the personal token that lets it in (`seedOwnerToken(...)`, in
  `apps/playground/test/harness/support.ts`) is the one thing a test writes to D1 itself.
- Cloudflare's `Service<...>` turns every RPC answer that holds `unknown` (an entry's frontmatter,
  its document) into `never`: read a binding through `HollwareRpc` of `@hollware/server`, as
  `examples/worker-site/src/env.ts` does.
- The `Probe` entrypoint of the playground (`apps/playground/src/probe.ts`) and of the example
  (`examples/worker-site/src/probe.ts`), each bound to itself as `PROBE`, is how a Node.js test asks
  a built Worker which Node.js globals it has. It is no route, so the gateway's guard has no
  exception for it.
- `budgets.json` holds the ceilings of the built playground Worker, minified and gzipped (main
  module 250 KiB, all modules 400 KiB, fixed before measuring); raising one needs a note in an ADR.
  `scripts/check-budgets.ts` fails above a ceiling, keeps Comark and `@comark/html` in lazy chunks
  (read from the source maps of the build), and logs startup and the cost of a write.
- The conformance Worker (`tests/conformance/worker`) runs under `wrangler dev`, never `vp dev`:
  Vite's host check would answer first and hide a missing DNS-rebinding guard. The run resets
  its local D1 and seeds it with the CLI; CI runs it in a job of its own.
- Test content is synthetic and shared: load it with `tests/fixtures/content.ts`, which
  works in Node and inside workerd (`tests/fixtures/README.md`). Rows of a second site,
  for the tests that one site cannot reach another, come from
  `packages/server/tests/support/sites.ts`.

## Layout

- `packages/core` — contracts, operation specs, schemas, Markdown pipeline. No Cloudflare imports.
- `packages/server` — the Worker: operation handlers, MCP, RPC, HTTP, auth, D1 migrations.
- `packages/client` — the same interface over a service binding or HTTP.
- `packages/admin` — the review and approval UI, prebuilt.
- `packages/cli` — the `hollware` CLI.
- `packages/create-hollware` — `npm create hollware`.
- `packages/nuxt` — `@hollware/nuxt`: reads Hollware from a Nuxt site.
- `apps/playground` — a local Hollware instance for development.
- `apps/web` — hollware.com: the landing page and the docs, read from Hollware.
- `templates/starter` — the thin project users get.
- `examples/worker-site` — a blog on a Worker that reads Hollware over a service binding.
- `examples/nuxt-blog` — a Nuxt blog on a Worker that reads Hollware through `@hollware/nuxt`.
- `tests/conformance/worker` — the Hollware Worker that the MCP conformance suite runs against.

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
- Inside the workspace a package resolves to its source: `exports` and `bin` point at
  the source, and only `publishConfig` points at the build (ADR-016). Nothing needs a
  build to type-check or test; `vp pack` writes those fields from each package's
  `vite.config.ts`, so change them there.
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
  `scripts/break-line.ts` and expect `CAUGHT`, which means the command passes as it is and
  fails with the line broken. Then read which test failed. `NOT CAUGHT` means nothing guards
  the line. `ERROR` is no verdict: the command already fails, timed out or was interrupted.
  Fix that and rerun.

## Verification surface

Every invariant this repository claims about itself is bound to a mechanism that
fails when the claim stops being true. When a change adds a source of truth, an
invariant or a convention, bind it to a test, a lint rule or a type in the same
change, and record it: a guard gets its line in the registry of `tests/AGENTS.md`. Never weaken
or delete a guard to make a change pass.

## Guards

What each guard binds, and how to write one, is in `tests/AGENTS.md`. A new guard adds its line there.

## Updating dependencies

1. Check what is outdated with `pnpm outdated -r`.
2. Pick versions published more than 24 hours ago and update the catalog.
3. Run `pnpm install`, then `vp run check:push`.
4. Read the changelogs of anything in a 0.x or release-candidate line before
   committing, and record notable changes in the commit message.
