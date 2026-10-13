# Tests

What lives in `tests/`: the guards of what this repository claims about itself, the tests of its CI scripts, and the fixtures that the tests of every package share. The tests of a package or an app sit next to their code.

- `tests/guards/` holds the guards. A guard is a pure function, `check...(input): Violation[]`, that gets the facts of the repository as arguments and holds no exception list of its own.
- `tests/conventions/` has one test per guard about a fact of the repository, and `tests/meta/` one per guard about the docs, the tests and the guards themselves. Each test runs its guard on this repository, where it finds no violation, and in a `describe('self-test: ...')` block on bad fixtures, where it asserts the exact violation.
- `tests/support/` holds what the guards stand on: the file list of the repository, readers of JSONC, Markdown, YAML, syntax trees and Vite+ tasks, and fixture builders. `tests/meta/scanners.test.ts` tests the readers.
- `tests/ci/` runs the shell scripts of the CI and release workflows.
- `tests/conformance/` runs the MCP conformance suite against the Worker of `tests/conformance/worker` (`vp run test:conformance`, ADR-022): its runner, its token proxy, its probes, its baselines and its must-pass profile.
- `tests/fixtures/` holds synthetic content, loaded through `tests/fixtures/content.ts` in Node and in workerd (`tests/fixtures/README.md`).

Exceptions live only in `tests/guards/exceptions.ts`, each with a reason, and a list may only shrink. Run the guards with `pnpm exec vp test --project repo`. Prove that a guard can fail with `node scripts/break-line.ts`, and read the name of the failing test: a command that fails for another reason proves nothing. After `vp run -r build`, `node scripts/check-bins.ts` runs each published bin (`publishConfig.bin`, the build) with `--version`.

## Guards

What each guard binds, one line per file of `tests/conventions/` and `tests/meta/`. A new guard adds its line here.

- `tests/conventions/manifests.test.ts`: the six packages share one manifest shape and version; `exports` and `bin` point at the source and `publishConfig` at `dist`; apps and templates are private.
- `tests/conventions/build-order.test.ts`: `check:push` runs `vp check` and `vp test` before anything builds, so CI proves that no package needs another one built.
- `tests/conventions/licenses.test.ts`: every package `LICENSE` is a byte copy of the root MIT one.
- `tests/conventions/no-claude-md.test.ts`: no `CLAUDE.md` anywhere, tracked or not.
- `tests/conventions/core-purity.test.ts`: `packages/core` has no Cloudflare or Node import, no Node global, no Cloudflare dependency; its `src` type-checks against the web platform only, and every one of its tests runs in Node and in workerd.
- `tests/conventions/server-types.test.ts`: `packages/server/src` type-checks with the generated Workers runtime types only, so a Node global is a type error.
- `tests/conventions/schema.test.ts`: every D1 table has an `id` primary key and its timestamps; a table outside `TABLES_WITHOUT_SITE` has `site_id`, its foreign key to `sites` and `UNIQUE(id, site_id)`, and its foreign keys to another site's table carry `site_id`.
- `tests/conventions/shipped-migrations.test.ts`: no migration that a `@hollware/server@*` release tag holds is edited or removed, and the release tags are there to compare.
- `tests/conventions/declared-imports.test.ts`: every bare import is declared by the package that makes it.
- `tests/conventions/catalog-deps.test.ts`: every dependency is `catalog:` or `workspace:*`, except a peer that is a caret range and also a dev dependency from the catalog.
- `tests/conventions/single-copies.test.ts`: zod, hono, drizzle-orm and `@modelcontextprotocol/server` resolve to one version each in what the workspace packages and apps install.
- `tests/conventions/changesets.test.ts`: `fixed` is one group, the published packages; public access.
- `tests/conventions/pnpm-policy.test.ts`: release age, trust policy, reasoned builds and excludes, exact catalog.
- `tests/conventions/wrangler-dates.test.ts`: no `compatibility_date` newer than the bundled workerd.
- `tests/conventions/wrangler-flags.test.ts`: every `wrangler.jsonc` lists `no_nodejs_compat` and `no_nodejs_compat_v2` and no positive Node.js flag; outside `templates/`, `send_metrics` is false.
- `tests/conventions/worker-projects.test.ts`: every Wrangler config sits in a workspace package that defines `build` and `types:check`, and `types:check` names a config below the package directory.
- `tests/conventions/conformance-baselines.test.ts`: each revision's baseline of the MCP conformance suite (`tests/conformance/baselines/`) names single checks with a class and a reason, never one of the must-pass profile, and keeps its recorded size; the profile keeps its claims.
- `tests/conventions/workflow-pinning.test.ts`: every action is a commit SHA with its `# vX.Y.Z`.
- `tests/conventions/workflow-permissions.test.ts`: `permissions: {}`, `id-token: write` only in `release.yml` `publish` and the Scorecard job, no kept credentials, Scorecard rules.
- `tests/conventions/workflow-forbidden.test.ts`: no npm token, `pnpm`, `yarn` or `changeset publish`, `npm stage`, `git push`, `npx` or `dlx`; `npm publish` only with `--provenance` in the `release.yml` `publish` job; zizmor ignores allowlisted.
- `tests/conventions/release-workflow.test.ts`: `release.yml` runs on `main` and `release`. Each job is gated to this repository and its branch (`main` versions; `release` promotes, packs, publishes and finalizes) and chained by `needs`, and `publish` is isolated. Runs go one at a time per ref: no cancel and no job-level group. The steps that run `promotion-check.sh` and `finalize-release.sh` pass exactly the env their script reads and check out the full history. `finalize_only` is wired: a boolean input, the promotion check skipped, pack and publish skipped with it, and finalize run after the skipped publish with `RELEASE_SHA` empty or the commit named in a `release_sha` input. `ci.yml` runs on `release` without the changeset gate and with `fetch-depth: 0`.
- `tests/conventions/setup-vp-version.test.ts`: `setup-vp` pins the catalog `vite-plus`; Node comes from `.node-version`.
- `tests/conventions/adr.test.ts`: ADR names, numbers, status and sections; the index and design table match the files.
- `tests/conventions/issue-forms.test.ts`: the issue forms are valid for GitHub and ask what `CONTRIBUTING.md` says.
- `tests/conventions/advisory-url.test.ts`: one private vulnerability reporting address across the docs.
- `tests/conventions/principles.test.ts`: the README principles are the feature request dropdown options.
- `tests/conventions/code-of-conduct.test.ts`: no template placeholder, one contact address.
- `tests/conventions/personal-email.test.ts`: no personal email address in any file.
- `tests/conventions/invisible-characters.test.ts`: no text file holds a bidirectional control, a zero-width mark, a byte order mark or a line or paragraph separator, outside `INVISIBLE_CHARACTER_FILES`.
- `tests/conventions/admin-isolation.test.ts`: no code outside `packages/admin` imports `@hollware/admin`.
- `tests/conventions/workerd-tests.test.ts`: `*.workerd.test.ts` is the name of tests importing `vitest` or `cloudflare:*`; no `fsModuleCache: true`.
- `tests/meta/agents-paths.test.ts`: backticked paths in `AGENTS.md` and `README.md` files exist.
- `tests/meta/agents-commands.test.ts`: the `vp run`, `pnpm --filter` and `node` commands `AGENTS.md` cites exist.
- `tests/meta/markdown-links.test.ts`: relative links and anchors in every Markdown file lead somewhere.
- `tests/meta/package-lists.test.ts`: Layout, README table and changeset README list the real packages.
- `tests/meta/agents-size.test.ts`: every `AGENTS.md` stays within 12,000 characters.
- `tests/meta/test-projects.test.ts`: every test file belongs to a project that `vp test` lists, or to a directory with a runner of its own whose task the root `vite.config.ts` defines and CI runs.
- `tests/meta/disabled-tests.test.ts`: no test file skips, postpones, focuses or conditions a test (`.skip`, `.todo`, `.only`, `.skipIf`, `.runIf`, `xit`, `xtest`, `xdescribe`), and there is no exception.
- `tests/meta/contributing.test.ts`: `CONTRIBUTING.md` agrees on Node.js, pnpm and the commands table.
- `tests/meta/exceptions.test.ts`: exception lists keep their recorded size; none lives outside `tests/guards/exceptions.ts`.
- `tests/meta/patches.test.ts`: a dependency patch starts with `PATCHED (reason)` and a test mentions it.
- `tests/meta/guards-registry.test.ts`: every guard file is cited here, once, with what it binds, and the root `AGENTS.md` points here without repeating a line.
- `tests/meta/self-tests.test.ts`: every exported `check...` of a guard is imported by a test whose `self-test` block calls it, directly or through a helper of the file, and asserts with `expect(`.
- `tests/meta/scanners.test.ts`: the JSONC, Markdown, source, syntax-tree, Vite+ task and workspace readers the guards stand on.
- `tests/ci/changeset-check.test.ts`: the changeset gate checks pull requests, pushes and manual runs. It skips only three cases: the branch creation, the Version Packages pull request from github-actions[bot], and its merge (squash or merge commit). It fails on a push whose previous tip is not an ancestor of the head.
- `tests/ci/promotion-check.test.ts`: the promotion gate refuses a commit that is not on `main`, a push that is not a fast-forward, a push without a previous tip (only a manual run may skip that check) and a commit with a pending changeset.
- `tests/ci/verify-and-publish.test.ts`: the shell of the `publish` job, run from `release.yml` with a stub `npm`, verifies the plan and every tarball before any publish. It skips versions npm has, publishes with `--provenance`, and refuses an npm answer for another version.
- `tests/ci/finalize-release.test.ts`: `finalize-release.sh` runs over a real git history with stub `gh`, `npm` and `sleep`. It waits until every version is live on npm with its provenance, then tags and releases only the public packages the release commit bumped. It uses the right Latest and prerelease flags and that commit's changelog notes, and leaves what already exists alone. It fails rather than settle on an older release when a later commit bumped the versions under a title the scan does not know.
