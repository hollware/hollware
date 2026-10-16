# ADR-015: A `release` branch for production, and direct publishing behind the `npm` environment approval

Status: Accepted (2026-10-11)

The approval of the `npm` environment that this record decides is gone since 2026-10-16: see [ADR-035](0035-a-push-to-release-publishes.md).

## Context

[ADR-013](0013-releases-with-changesets.md) and [ADR-014](0014-release-pipeline.md) made every release pass two independent human factors. CI staged each package on npm without a 2FA prompt, and the maintainer approved each staged version on npm with 2FA. Release `0.0.1` shipped that way on 2026-10-11, and it showed the price: six packages are six separate 2FA approvals, one `npm stage approve` each and dependencies first, on top of the click that approves the GitHub environment `npm`. The maintainer decided that the second factor is not worth that friction.

Two other facts shape the decision. npm trusted publishing over OIDC can publish directly, with a provenance attestation, from a job that has no stored token. And a GitHub environment with a required reviewer stops its job until that person approves it. ADR-013 rejected publishing without staging because no person would be present for the release, and the environment approval puts one there. Together they give a gate that needs one approval per release, however many packages it holds.

Dropping staging also removes what separated "a merge happened" from "a release goes out". In ADR-014 the merge of the Version Packages pull request to `main` started the publishing path. A release needs an explicit act of its own, and development should stay apart from production.

## Decision

- **What stays from ADR-013.** Changesets 3 versions the repository with a fixed group, so the six published packages share one version. Every pull request that touches a package carries a changeset. `changesets/action` opens the Version Packages pull request. CI publishes only through OIDC trusted publishing, with no stored tokens and with provenance. Every pull request gets pkg.pr.new previews. The `0.0.0` placeholders reserved the names.
- **What is replaced.** npm staged publishing and the per-version 2FA approval on npm, which ADR-013 decided and ADR-014 built. They give way to the approval of the GitHub environment `npm`, and to the `release` branch.
- **`main` is for development and `release` is what ships.** Publishing happens only from `release`. It only moves by fast-forward to a commit that is on `main`, which is the Version Packages merge: `git push origin <commit>:release`. A ruleset forbids deleting it and forcing it.
- **A push to `main`** runs `select-mode` and `version`, which open or update the Version Packages pull request. It never packs or publishes.
- **A push to `release`** runs `release.yml` as a chain of jobs, and a `workflow_dispatch` with `finalize_only` on `release` runs the last one.
  1. `promotion-check` fails unless the pushed commit is an ancestor of, or equal to, `origin/main`, the push moved `release` forward by fast-forward, and `.changeset/` holds no pending changeset. The message to the maintainer is to version on `main` first, then promote.
  2. `pack` builds and packs the versions that npm does not have yet, as in ADR-014. When every public version is already on npm, it does nothing.
  3. `publish` runs in the environment `npm`, which only `release` can deploy to and which waits for the maintainer's approval. It has `id-token: write`, checks nothing out and runs no repository code, with Node 24.21.0 and the npm it bundles. It verifies the publish plan and every tarball (sha256, `name@version` inside the tarball, no `publishConfig` beyond access and provenance, no unlisted file) and runs `npm publish <tarball> --registry <npm> --provenance --access <access> --tag <tag>` for each package, dependencies first. A version that is already on npm is skipped, so the job can be run again.
  4. `finalize` waits until every version is live with its provenance attestation, then creates the tags and the GitHub Releases with an explicit token, as in ADR-014.
- **npm side.** Each package's trusted publisher is bound to the repository `hollware/hollware`, the workflow `release.yml` and the environment `npm`, and it allows direct publishing. Every package stays set to "require 2FA and disallow tokens": OIDC is not a token, so it still publishes, and a stolen token cannot.
- **Bound by tests.** The `release-workflow`, `workflow-forbidden` and `workflow-permissions` guards, and two script tests: `tests/ci/promotion-check.test.ts` and `tests/ci/verify-and-publish.test.ts`. `npm publish` is allowed only in the `publish` job of `release.yml`, and only with `--provenance`. `id-token: write` belongs to that job and to the Scorecard job.

## Consequences

- A release is three acts: merge the Version Packages pull request, push its commit to `release`, and approve the `npm` environment. One approval per release replaces six 2FA approvals.
- The security model has one factor where it had two. Before, shipping a malicious version took a compromised CI job and the maintainer's separate npm 2FA. Now it takes the maintainer's GitHub account, whose 2FA the organization enforces, to approve the environment. Whoever controls that account can approve a release, and a commit they get onto `main` and then `release` ships. Several things still hold:
  - CI cannot approve its own publish.
  - Only `release` can deploy to the environment.
  - A ruleset lets `release` move only by fast-forward.
  - The trusted publisher is bound to one workflow and environment.
  - Every version carries a provenance attestation.

  `promotion-check` checks that a promoted commit is on `main`. It runs from the promoted commit itself, so the place that really enforces this is the environment approval.

- Agents can start a release if they can push to `release`, but the release goes out only when the maintainer approves the environment. That stays a human act as long as the credentials agents use cannot review deployments, so those credentials must not be able to.
- A push to `release` cannot be taken back, because the ruleset forbids force pushes for everyone, admins included. If a commit lands there by mistake, nothing is published, because `promotion-check` fails. But the next promotion is rejected as a non-fast-forward until an admin relaxes the ruleset, moves the branch back and restores the rule. Checking the ancestry before promoting avoids this (`.github/AGENTS.md`).
- A partial publish is possible. If the job fails half-way, some versions are on npm and the fixed group is inconsistent until the job is run again. Running it again publishes what is missing and skips what is there.
- npm refuses to move `latest` to a lower version unless the tag is given explicitly, and `publish` always gives it. The fast-forward rule is what keeps promoted versions increasing.
- `publish` trusts `pack` for what is inside the tarballs. It checks that nothing changed between the two jobs and that the plan holds no hostile value, not that the build was honest: the maintainer's approval of the environment is where a person vouches for the commit.
- The shell of `publish` stays inline in the workflow, because the job checks out nothing. Its test extracts that text from `release.yml` and runs it with a stub `npm`.
- The text of the Version Packages pull request is written by the action and says that merging it publishes. It does not: the maintainer promotes the commit.
- `finalize` no longer waits for a person, so it gives up after thirty minutes instead of two hours.
- Release `0.0.2` was the first run of `publish`. It stopped half-way, at a package whose trusted publisher still allowed only staging, and running the job again published the rest.

## Alternatives considered

- Keep npm staging. It has two independent factors, because CI stages and the maintainer approves on npm with 2FA. Rejected by the maintainer: six 2FA approvals per release are too much friction for a project with one maintainer.
- Publish from `main`, with the merge of the Version Packages pull request starting the publish behind the environment approval. It has fewer moving parts. Rejected: development and production would not be separate, and every push to `main` would walk the publishing path.
- A Version Packages pull request that targets `release`. Rejected: it adds moving parts, because the two branches would diverge and changesets would be consumed on a branch other than the one they were written on.
