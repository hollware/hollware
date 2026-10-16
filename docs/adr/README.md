# Architecture decision records

An architecture decision record (ADR) documents one structural decision of Hollware: the situation that forced it, what was decided, what follows from it and what else was considered. The [design document](../design.md) is the overview, and the ADRs hold the reasoning behind it.

## Rules

- **Decisions change only through a new or superseding ADR, never silently.** An accepted ADR is not edited to change its decision. To change one, write a new ADR that says which one it supersedes, and mark the old one `Superseded by ADR-NNN`. Typos, broken links and clarifications that do not change the decision can be fixed in place.
- ADRs are numbered in sequence, and a number is never reused. The file is named `NNNN-kebab-case-title.md` (four digits) and its first line is `# ADR-NNN: Title` (three digits).
- The status line is `Status: Proposed (YYYY-MM-DD)`, `Status: Accepted (YYYY-MM-DD)` or `Status: Superseded by ADR-NNN (YYYY-MM-DD)`. The date is the day the status was set.
- A proposed ADR becomes accepted when it is confirmed, which normally happens when the code that depends on it starts. If it is dropped, a new ADR supersedes it. It is not deleted.
- Every ADR has exactly the sections of the template below, in that order, and no others.
- The index below lists exactly the ADR files in this directory. A change that adds an ADR adds its row in the same commit.
- ADRs are written in English, like everything else in the repository.

## Index

| ADR | Title                                                                                                       | Status                | Link                                                                                                                                           |
| --- | ----------------------------------------------------------------------------------------------------------- | --------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| 001 | Markdown is the source of truth; the Comark document is derived                                             | Accepted              | [0001-markdown-is-the-source-of-truth.md](0001-markdown-is-the-source-of-truth.md)                                                             |
| 002 | D1 is the single source of truth                                                                            | Accepted              | [0002-d1-is-the-single-source-of-truth.md](0002-d1-is-the-single-source-of-truth.md)                                                           |
| 003 | One operation registry, three surfaces (RPC, HTTP + OpenAPI 3.1, MCP)                                       | Accepted              | [0003-one-operation-registry-three-surfaces.md](0003-one-operation-registry-three-surfaces.md)                                                 |
| 004 | Write-time contracts with a single definition                                                               | Accepted              | [0004-write-time-contracts-with-a-single-definition.md](0004-write-time-contracts-with-a-single-definition.md)                                 |
| 005 | Cloudflare OAuth provider, passkeys and personal tokens                                                     | Accepted              | [0005-cloudflare-oauth-provider-passkeys-and-personal-tokens.md](0005-cloudflare-oauth-provider-passkeys-and-personal-tokens.md)               |
| 006 | One deployment per account, several sites inside                                                            | Accepted              | [0006-one-deployment-per-account-several-sites-inside.md](0006-one-deployment-per-account-several-sites-inside.md)                             |
| 007 | Admin in Vue 3.5 with Nuxt UI 4, without Nuxt                                                               | Accepted              | [0007-admin-in-vue-with-nuxt-ui-without-nuxt.md](0007-admin-in-vue-with-nuxt-ui-without-nuxt.md)                                               |
| 008 | Independent project, MIT, own GitHub organization                                                           | Accepted              | [0008-independent-project-mit-own-github-organization.md](0008-independent-project-mit-own-github-organization.md)                             |
| 009 | Cloudflare only until v1                                                                                    | Accepted              | [0009-cloudflare-only-until-v1.md](0009-cloudflare-only-until-v1.md)                                                                           |
| 010 | Vite+ with pnpm 12, distributed as a library (thin user project)                                            | Accepted              | [0010-vite-plus-with-pnpm-distributed-as-a-library.md](0010-vite-plus-with-pnpm-distributed-as-a-library.md)                                   |
| 011 | Cloudflare's Vite plugin today, the `cf` CLI later                                                          | Accepted              | [0011-cloudflare-vite-plugin-today-cf-cli-later.md](0011-cloudflare-vite-plugin-today-cf-cli-later.md)                                         |
| 012 | Official MCP SDK v2; the Agents SDK only for Hollware's own agents                                          | Accepted              | [0012-official-mcp-sdk-v2.md](0012-official-mcp-sdk-v2.md)                                                                                     |
| 013 | Releases with Changesets, one version for all packages, OIDC and staged publishing with maintainer approval | Superseded by ADR-015 | [0013-releases-with-changesets.md](0013-releases-with-changesets.md)                                                                           |
| 014 | Release pipeline: Changesets versions, `npm stage publish` publishes                                        | Superseded by ADR-015 | [0014-release-pipeline.md](0014-release-pipeline.md)                                                                                           |
| 015 | A `release` branch for production, and direct publishing behind the `npm` environment approval              | Accepted              | [0015-release-branch-and-direct-publishing.md](0015-release-branch-and-direct-publishing.md)                                                   |
| 016 | Workspace packages resolve to their source; `dist` only in the published manifest                           | Accepted              | [0016-workspace-packages-resolve-to-source.md](0016-workspace-packages-resolve-to-source.md)                                                   |
| 017 | Operation specs live in `core`; handlers and adapters in `server`                                           | Accepted              | [0017-operation-specs-in-core-handlers-in-server.md](0017-operation-specs-in-core-handlers-in-server.md)                                       |
| 018 | `core` type-checks against the web platform and runs its tests in Node and workerd                          | Accepted              | [0018-core-type-checks-against-the-web-platform.md](0018-core-type-checks-against-the-web-platform.md)                                         |
| 019 | Personal tokens in v0.1; OAuth and passkeys arrive with the admin                                           | Accepted              | [0019-personal-tokens-in-v0-1-oauth-with-the-admin.md](0019-personal-tokens-in-v0-1-oauth-with-the-admin.md)                                   |
| 020 | Content safety is a contract: raw HTML, unknown components and unsafe attributes are errors at write time   | Accepted              | [0020-content-safety-is-a-contract.md](0020-content-safety-is-a-contract.md)                                                                   |
| 021 | Revisions, their tags and publications are append-only; child rows are written only with their revision     | Accepted              | [0021-append-only-revisions-and-publications.md](0021-append-only-revisions-and-publications.md)                                               |
| 022 | MCP conformance runs in CI against a baseline that only shrinks and never covers what Hollware claims       | Accepted              | [0022-mcp-conformance-with-a-shrinking-baseline.md](0022-mcp-conformance-with-a-shrinking-baseline.md)                                         |
| 023 | Migrations only move forward, and a shipped migration never changes                                         | Accepted              | [0023-forward-only-migrations.md](0023-forward-only-migrations.md)                                                                             |
| 024 | Entries that link to each other are published together, in one step                                         | Accepted              | [0024-publish-a-group-of-entries-in-one-step.md](0024-publish-a-group-of-entries-in-one-step.md)                                               |
| 025 | Publishing commits in one batch, and its effects go through an outbox                                       | Accepted              | [0025-publish-commits-in-one-batch-and-effects-go-through-an-outbox.md](0025-publish-commits-in-one-batch-and-effects-go-through-an-outbox.md) |
| 026 | OAuth, passkeys and the admin's sign-in                                                                     | Accepted              | [0026-oauth-passkeys-and-the-admin-sign-in.md](0026-oauth-passkeys-and-the-admin-sign-in.md)                                                   |
| 027 | One person across the sites of a deployment                                                                 | Accepted              | [0027-one-person-across-the-sites-of-a-deployment.md](0027-one-person-across-the-sites-of-a-deployment.md)                                     |
| 028 | Read tokens, and CORS for the read API                                                                      | Accepted              | [0028-read-tokens-and-cors-for-the-read-api.md](0028-read-tokens-and-cors-for-the-read-api.md)                                                 |
| 029 | Full-text search in D1                                                                                      | Accepted              | [0029-full-text-search-in-d1.md](0029-full-text-search-in-d1.md)                                                                               |
| 030 | Vectors as derived data                                                                                     | Accepted              | [0030-vectors-as-derived-data.md](0030-vectors-as-derived-data.md)                                                                             |
| 031 | Page views without personal data                                                                            | Accepted              | [0031-page-views-without-personal-data.md](0031-page-views-without-personal-data.md)                                                           |
| 032 | Agents that never publish                                                                                   | Accepted              | [0032-agents-that-never-publish.md](0032-agents-that-never-publish.md)                                                                         |
| 033 | The structure lives in D1                                                                                   | Accepted              | [0033-the-structure-lives-in-d1.md](0033-the-structure-lives-in-d1.md)                                                                         |
| 034 | Our deployments run from CI                                                                                 | Accepted              | [0034-our-deployments-run-from-ci.md](0034-our-deployments-run-from-ci.md)                                                                     |
| 035 | A push to `release` publishes, with no approval of the `npm` environment                                    | Accepted              | [0035-a-push-to-release-publishes.md](0035-a-push-to-release-publishes.md)                                                                     |

## Template

```markdown
# ADR-NNN: Title

Status: Proposed (YYYY-MM-DD)

## Context

The situation that forces the decision: the constraints, the numbers and the earlier decisions that matter.

## Decision

What is decided, in the present tense and specific enough that a test or a review can tell whether the code follows it.

## Consequences

What becomes easier, what becomes harder, and what has to stay true for the decision to keep working.

## Alternatives considered

Each option that was rejected or postponed, with the reason.
```
