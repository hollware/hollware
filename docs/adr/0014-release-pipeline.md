# ADR-014: Release pipeline: Changesets versions, `npm stage publish` publishes

Status: Superseded by ADR-015 (2026-10-11)

## Context

[ADR-013](0013-releases-with-changesets.md) chose Changesets for versioning and npm staged publishing for the human approval. The two do not compose out of the box: Changesets cannot do npm staged publishing, and its documentation says so. Its `changeset publish` command publishes directly, so using it would bypass the staging step and leave no human gate.

npm's own documentation describes the other half. `npm stage publish` places a package in the registry in a state where it is not publicly available, without asking for 2FA. `npm stage approve` publishes it and does ask for 2FA. A trusted publisher (OIDC) can be limited to staging with `--allow-stage-publish`, and the package must already exist.

Hollware therefore splits a release in two. Changesets decides the versions and the changelogs. `npm stage publish` is the only step that sends a package to npm, and it runs in a job that executes no repository code.

## Decision

`release.yml` is a chain of jobs. Its global permissions are empty (`permissions: {}`), runs are serialized by a `release` concurrency group, every job is guarded by `github.repository == 'hollware/hollware'`, and a `workflow_dispatch` entry can run only the finalize step.

1. `select-mode` decides what the run does.
2. `version` runs `changesets/action` and opens or updates the Version Packages pull request.
3. `pack` packs every package, which rewrites the `workspace:` and `catalog:` specifiers, and uploads the tarballs and their sha256 hashes as an artifact.
4. `stage` runs in the GitHub environment `npm`, which waits for the maintainer's approval. It has `id-token: write`, does not check out the repository and runs no repository code. It uses a pinned Node 24.21.0, whose npm supports staging, verifies every tarball against its sha256, and runs `npm stage publish <tgz> --provenance --access public`. The hashes are printed for the maintainer.
5. The maintainer approves the staged versions on npm, with 2FA.
6. `finalize` waits until the versions are live, verifies the provenance attestations (`dist.attestations`), and creates the tags and the GitHub Releases with an explicit token. It has a timeout and never persists credentials.

The six package names are reserved before the repository goes public, with placeholder versions `0.0.0`. Trusted publishing is configured stage-only, right before the first release, with `npm trust github <package> --file release.yml --repo hollware/hollware --env npm --allow-stage-publish`, and every package is then set to require 2FA and disallow tokens. The version script is `changeset version && pnpm install --lockfile-only && vp fmt`.

## Consequences

- Nothing reaches npm without a human 2FA approval. Staging needs no 2FA and only approving does, so a compromised or misbehaving CI job can at most stage versions that never go live without the maintainer.
- Because `stage` has no checkout and runs no repository code, the only code that runs in the job holding `id-token: write` is the workflow itself, the pinned Node and the pinned npm. It publishes the tarballs that `pack` produced, after checking their hashes.
- A release can be finalized later. If the approval takes longer than the timeout of `finalize`, running the workflow by hand through `workflow_dispatch` executes only the finalize step.
- A staged version shares the version index with published ones, so a staged version has to be approved or rejected before the same version can be staged again.
- Several npm behaviors around staging are not confirmed yet, for example how provenance is recorded once a staged version is approved and how long a trust configuration stays valid when it is not used. The first release, `0.0.1` at the end of phase F0, exercises the whole pipeline before it matters, and `finalize` verifies the attestations instead of assuming them.
- Tags and GitHub Releases are created by `finalize`, with an explicit token and no persisted credentials, because `changeset publish` is not used.

## Alternatives considered

- `changeset publish` with tokens. Rejected: it publishes directly with a credential, so there is no human gate.
- pnpm's own versioning and publishing. Rejected: it gives no Version Packages pull request, no tags and no GitHub Releases.
- Checking out the repository in the `stage` job and packing there. Rejected: it would run repository code in the one job that holds `id-token: write`. The `pack` job produces the tarballs, and `stage` only verifies and stages them.
- Trusted publishing with `--allow-publish` and no staging. Rejected: any change that reaches `main` could be published without a person present.
