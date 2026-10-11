# ADR-010: Vite+ with pnpm 12, distributed as a library (thin user project)

Status: Accepted (2026-10-11)

## Context

Hollware is a monorepo of six published packages plus apps, templates and examples, and it has a single maintainer. Keeping separate tools for building, testing, linting, formatting and running tasks means more configuration to keep in sync.

Users, for their part, should be able to adopt Hollware without owning its code, and to upgrade without merge conflicts. There are two ways to distribute a CMS: as a full application that the user forks, or as a library plus a thin project, the way Payload and EmDash ship.

## Decision

- **Toolchain.** Vite+ 1.1 handles building, testing, linting, formatting and cached tasks in one tool: Vite, Vitest 5, Oxlint, Oxfmt and tsdown. The project-local `vp` is always the one that runs, because a global `vp` of another version breaks the Cloudflare plugin.
- **Package manager.** pnpm 12, pinned with its hash. Catalogs and the supply-chain policy live in `pnpm-workspace.yaml`: exact versions, a `minimumReleaseAge` of 1440 minutes, `trustPolicy: no-downgrade` and an explicit `allowBuilds`.
- **Runtime.** Node 24 LTS, with the exact patch pinned in `.node-version`. Node 26 is reviewed when it becomes LTS, in late October 2026.
- **Layout.** `packages/{core,server,client,admin,cli,create-hollware}`, `templates/starter`, `apps/{docs,playground}` and `examples/`. `core` does not depend on Cloudflare.
- **Distribution.** A library with a thin user project. The user keeps a Worker of a few lines that re-exports the Durable Objects and Workflows from `@hollware/server`. The D1 migrations ship inside `@hollware/server` and are applied with `hollware migrate`. Upgrading means bumping a version and running the migrations.

## Consequences

- One tool and one configuration for the whole repository, and the git hooks and CI run tasks that are defined in the same place.
- pnpm's release-age and trust policies apply to every dependency. A version published less than 24 hours ago cannot be pinned without an exception that carries a reason and an expiry date.
- Upgrading a user's project is a version bump plus `hollware migrate`. In exchange, the user's Worker re-exports what Hollware defines, so renaming an exported class is a breaking change for every user.
- pnpm 12 runs scripts in a new process group, so anything that supervises a server, such as the web server of an end-to-end test runner, must start the binary directly and never through `pnpm dev`.
- Vite+ and pnpm 12 are young tools, so versions are exact in the catalog and the stack is reviewed at the start of every stage.

## Alternatives considered

- A full application that users fork. Rejected: the user owns the code, so every upgrade becomes a manual merge.
- Separate tools for each job: a bundler, a test runner, a linter, a formatter and a task runner. Rejected: more configuration to keep in sync, against one tool that covers all of it.
- Another package manager. Not chosen: pnpm's minimum release age and provenance policies are the reason for the choice.
