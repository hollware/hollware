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

## Updating dependencies

1. Check what is outdated with `pnpm outdated -r`.
2. Pick versions published more than 24 hours ago and update the catalog.
3. Run `pnpm install`, then `vp run check:push`.
4. Read the changelogs of anything in a 0.x or release-candidate line before
   committing, and record notable changes in the commit message.
