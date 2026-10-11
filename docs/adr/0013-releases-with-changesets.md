# ADR-013: Releases with Changesets, one version for all packages, OIDC and staged publishing with maintainer approval

Status: Accepted (2026-10-11)

## Context

Hollware publishes six packages that evolve together. Someone who installs `@hollware/server` at one version should get the `@hollware/core`, `@hollware/client` and `hollware` CLI that were tested with it, without working out a compatibility matrix.

Publishing is also the highest-risk action of the repository: a compromised CI job or a leaked token must not be enough to push a release. npm's staged publishing, generally available since May 2026 and requiring npm 11.15 or later, separates the two steps. Automation stages a package without a 2FA prompt, and a maintainer approves it later with 2FA. Staging requires the package to exist already.

## Decision

- Changesets 3 (3.0.x) versions the repository, with a fixed group so that all six packages share one version.
- Every pull request that touches a package carries a changeset. An agent can write it, CI requires it, and it must say when the change includes D1 migrations.
- The release pull request is opened by `changesets/action`.
- CI publishes with trusted publishing (OIDC, no stored tokens) and provenance, as npm staged publishing: nothing reaches npm until the maintainer approves it with 2FA.
- Every pull request produces installable preview builds with pkg.pr.new.
- The first publication of each package is manual, because staging requires the package to exist. Placeholder versions `0.0.0` reserve the names. The pipeline itself is described in [ADR-014](0014-release-pipeline.md).

## Consequences

- One version number to reason about, one changelog and no drift between packages.
- No release reaches npm without a person approving it with 2FA, even if CI is compromised.
- While Hollware is 0.x, a minor version may break compatibility, and `hollware migrate` warns about it.
- The first release of each package is a manual placeholder publish, done before the repository goes public.
- Changesets cannot do staged publishing itself, which is why the publishing step is separate (see [ADR-014](0014-release-pipeline.md)).
- Each pull request that touches a package needs a changeset. The cost is one small file, which an agent can write.

## Alternatives considered

- Independent versions for each package. Rejected: consumers would need a compatibility matrix between packages that always ship together.
- Publishing from CI with long-lived npm tokens. Rejected: a token is enough to publish, so there is no human gate.
- Trusted publishing without staging, so that a merge to `main` publishes by itself. Rejected: no person is present for the release, and any change that reaches `main` would reach npm.
