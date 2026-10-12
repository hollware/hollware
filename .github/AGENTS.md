# CI and releases

Rules for `.github/` and `.changeset/`. Convention tests enforce them (`tests/conventions/workflow-pinning.test.ts`, `workflow-permissions.test.ts`, `workflow-forbidden.test.ts`, `release-workflow.test.ts`, `setup-vp-version.test.ts`), `tests/ci/` runs the scripts, and zizmor audits the rest in `security.yml`.

## Workflows

- Pin every action by its 40-character commit SHA followed by `# vX.Y.Z`, subpath actions included (`changesets/action/pack`). Resolve a tag with `gh api repos/<owner>/<repo>/commits/<tag> --jq .sha`: it returns the commit, never an annotated tag object.
- Start every workflow with `permissions: {}` and grant each job the minimum. `id-token: write` belongs to the `publish` job of `release.yml` and to the Scorecard job of `security.yml`, nowhere else.
- Every checkout sets `persist-credentials: false`. `gh` gets `GH_TOKEN: ${{ github.token }}`. Nothing pushes with git credentials.
- No npm tokens, no `npx`, no `dlx`. The only publish command is `npm publish` with `--provenance`, in the `publish` job of `release.yml`, over OIDC trusted publishing.
- Node comes from `.node-version` (`24.21.0` where nothing is checked out), pnpm from `packageManager`, Vite+ from `setup-vp` at the `vite-plus` catalog version.
- Untrusted values (refs, commit messages, inputs) reach shell code through `env:`, never through `${{ }}` inside `run:`. Non-trivial shell lives in `.github/scripts/`. `publish` checks out nothing, so its shell is inline, and `tests/ci/verify-and-publish.test.ts` runs that very text from `release.yml`.

## Release flow

`main` is for development and `release` is what ships (ADR-015). `release` only moves by fast-forward to a commit that is on `main`.

1. A push to `main` runs `release.yml` in version mode: `select-mode`, then `version` runs `pnpm run version-packages` and opens the "Version Packages" pull request. `GITHUB_TOKEN` makes it, so CI does not run on it: close and reopen it to run CI. Keep its title, because `ci.yml` skips the changeset check on its merge. Its text, written by the action, says that merging publishes. It does not.
2. Merge it, wait for CI on `main`, then promote the merge commit with `git push origin <commit>:release`, fast-forward only. `<commit>` is the Version Packages merge on `main`.
3. A push to `release` runs, in order, `promotion-check` (`.github/scripts/promotion-check.sh`: the commit is on `main`, the push is a fast-forward and `.changeset/` holds no changeset), `pack` (builds, then writes the tarballs and `publish-plan.json`, which holds the sha256 of each; it does nothing when every version is on npm) and `publish`.
4. `publish` (environment `npm`, no checkout, no repository code) waits for the maintainer to approve the environment. It verifies the plan and every tarball, then runs `npm publish --provenance` for each package, dependencies first, and skips a version that is already on npm. After a failure, run the job again: it publishes what is left. Runs of `release` go one at a time, so approve or cancel a waiting run before promoting the next commit.
5. `finalize` waits until every version is live with its provenance attestation, then creates the tags `<name>@<version>` and the GitHub Releases. If it fails, run `release.yml` on `release` with `finalize_only`.

## Also

- `.github/scripts/changeset-check.sh` is the CI changeset gate. `ci.yml` also runs on `release` and skips the gate there, because `release` only takes commits whose changesets are consumed. `finalize-release.sh` is idempotent: it tags and releases the `packages/*` whose version the release commit bumped. A published package lives in `packages/` and is listed in `fixed` in `.changeset/config.json`.
- `security.yml` keeps Scorecard's rules: no top-level `env` or `defaults`, no OIDC token in another job, only approved actions in its job.
- The workflows assume these settings. GitHub: the environment `npm` (only `release` may deploy to it, with maintainer approval), a ruleset on `release` (no deletion, no force push), Actions allowed to create pull requests, and tag rulesets that let the Actions bot create `*@*` and `@*/*@*` tags. npm: each package trusts `release.yml` of `hollware/hollware` with the environment `npm` and allows direct publishing.

## Bumping an action

1. Pick the release and read its notes.
2. Resolve its SHA with the command above and read `action.yml` at that SHA.
3. Replace the SHA and the `# vX.Y.Z` comment everywhere: `grep -rn <old sha> .github`.
4. Run `zizmor .github/workflows` and `vp check`.
5. Never use a tag or a branch, and never copy a SHA from a third-party list.
