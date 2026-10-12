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

| ADR | Title                                                                                                       | Status                | Link                                                                                                                             |
| --- | ----------------------------------------------------------------------------------------------------------- | --------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| 001 | Markdown is the source of truth; the Comark document is derived                                             | Accepted              | [0001-markdown-is-the-source-of-truth.md](0001-markdown-is-the-source-of-truth.md)                                               |
| 002 | D1 is the single source of truth                                                                            | Accepted              | [0002-d1-is-the-single-source-of-truth.md](0002-d1-is-the-single-source-of-truth.md)                                             |
| 003 | One operation registry, three surfaces (RPC, HTTP + OpenAPI 3.1, MCP)                                       | Accepted              | [0003-one-operation-registry-three-surfaces.md](0003-one-operation-registry-three-surfaces.md)                                   |
| 004 | Write-time contracts with a single definition                                                               | Accepted              | [0004-write-time-contracts-with-a-single-definition.md](0004-write-time-contracts-with-a-single-definition.md)                   |
| 005 | Cloudflare OAuth provider, passkeys and personal tokens                                                     | Accepted              | [0005-cloudflare-oauth-provider-passkeys-and-personal-tokens.md](0005-cloudflare-oauth-provider-passkeys-and-personal-tokens.md) |
| 006 | One deployment per account, several sites inside                                                            | Proposed              | [0006-one-deployment-per-account-several-sites-inside.md](0006-one-deployment-per-account-several-sites-inside.md)               |
| 007 | Admin in Vue 3.5 with Nuxt UI 4, without Nuxt                                                               | Accepted              | [0007-admin-in-vue-with-nuxt-ui-without-nuxt.md](0007-admin-in-vue-with-nuxt-ui-without-nuxt.md)                                 |
| 008 | Independent project, MIT, own GitHub organization                                                           | Accepted              | [0008-independent-project-mit-own-github-organization.md](0008-independent-project-mit-own-github-organization.md)               |
| 009 | Cloudflare only until v1                                                                                    | Proposed              | [0009-cloudflare-only-until-v1.md](0009-cloudflare-only-until-v1.md)                                                             |
| 010 | Vite+ with pnpm 12, distributed as a library (thin user project)                                            | Accepted              | [0010-vite-plus-with-pnpm-distributed-as-a-library.md](0010-vite-plus-with-pnpm-distributed-as-a-library.md)                     |
| 011 | Cloudflare's Vite plugin today, the `cf` CLI later                                                          | Accepted              | [0011-cloudflare-vite-plugin-today-cf-cli-later.md](0011-cloudflare-vite-plugin-today-cf-cli-later.md)                           |
| 012 | Official MCP SDK v2; the Agents SDK only for Hollware's own agents                                          | Accepted              | [0012-official-mcp-sdk-v2.md](0012-official-mcp-sdk-v2.md)                                                                       |
| 013 | Releases with Changesets, one version for all packages, OIDC and staged publishing with maintainer approval | Superseded by ADR-015 | [0013-releases-with-changesets.md](0013-releases-with-changesets.md)                                                             |
| 014 | Release pipeline: Changesets versions, `npm stage publish` publishes                                        | Superseded by ADR-015 | [0014-release-pipeline.md](0014-release-pipeline.md)                                                                             |
| 015 | A `release` branch for production, and direct publishing behind the `npm` environment approval              | Accepted              | [0015-release-branch-and-direct-publishing.md](0015-release-branch-and-direct-publishing.md)                                     |
| 016 | Workspace packages resolve to their source; `dist` only in the published manifest                           | Accepted              | [0016-workspace-packages-resolve-to-source.md](0016-workspace-packages-resolve-to-source.md)                                     |
| 017 | Operation specs live in `core`; handlers and adapters in `server`                                           | Accepted              | [0017-operation-specs-in-core-handlers-in-server.md](0017-operation-specs-in-core-handlers-in-server.md)                         |

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
