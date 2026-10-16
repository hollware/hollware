# ADR-035: A push to `release` publishes, with no approval of the `npm` environment

Status: Accepted (2026-10-16)

## Context

[ADR-015](0015-release-branch-and-direct-publishing.md) put one human act between a commit and npm, besides promoting it: the maintainer approved the GitHub environment `npm`, whose job then published with OIDC. Releases `0.1.0` to `0.9.0` went out that way. The maintainer already promotes every release by hand (`git push origin <sha>:release`), after CI passed on `main`, and asked on 2026-10-16 that publishing then run on its own in CI, with no second click.

## Decision

- **The environment `npm` has no required reviewer.** Its other rule stays: only the branch `release` may deploy to it. A push to `release` packs, publishes and tags the release with no person in between.
- Everything else of ADR-015 holds: `release` moves only by fast-forward to a commit on `main`, `promotion-check` refuses another, `publish` checks out nothing and runs no repository code, the trusted publisher is bound to `release.yml` and the environment `npm`, and every version carries a provenance attestation.

## Consequences

- A release is two acts: merge the Version Packages pull request, and push its commit to `release`.
- The push to `release` is the only human gate, and the place that vouches for the commit. Whoever can push to `release` can publish to npm: the maintainer, and any agent that works with the maintainer's GitHub credentials. A session that should not publish must not push to `release`; the maintainer can make an agent ask first with an `ask` rule for `git push * release` in its own settings.
- `promotion-check` runs from the promoted commit itself, so a commit pushed to `release` that is not on `main` is refused by that check alone, with no approval behind it.
- A mistaken push to `release` of a commit on `main` publishes it. The ruleset still forbids moving `release` back, so the way out is a new version.

## Alternatives considered

- Keep the approval of the environment (ADR-015). It keeps a second human act, and the one an agent cannot do with the maintainer's credentials only while those credentials cannot review deployments. Rejected by the maintainer: the promotion is already a deliberate act, and a second click for each release is friction.
- Publish on the merge of the Version Packages pull request, from `main`. Rejected for the reason ADR-015 gives: development and production would not be separate.
