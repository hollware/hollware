# CI and releases

Rules for `.github/` and `.changeset/`. A convention test (coming in F0-5) enforces the workflow rules; until it lands, review them by hand and run zizmor.

## Workflows

- Pin every action by its 40-character commit SHA followed by `# vX.Y.Z`, subpath actions included (`changesets/action/pack`). Resolve a tag with `gh api repos/<owner>/<repo>/commits/<tag> --jq .sha`: it returns the commit, never an annotated tag object.
- Start every workflow with `permissions: {}` and grant each job the minimum. `id-token: write` belongs to the `stage` job of `release.yml` and to the Scorecard job of `security.yml`, nowhere else.
- Every checkout sets `persist-credentials: false`. `gh` gets `GH_TOKEN: ${{ github.token }}`. Nothing pushes with git credentials.
- No npm tokens, no `npm publish`, no `npx`, no `dlx`. Publishing is OIDC trusted publishing through `npm stage publish`.
- Node comes from `.node-version` (`24.21.0` where nothing is checked out), pnpm from `packageManager`, Vite+ from `setup-vp` at the `vite-plus` catalog version.
- Untrusted values (refs, commit messages, inputs) reach shell code through `env:`, never through `${{ }}` inside `run:`. Non-trivial shell lives in `.github/scripts/`. `stage` checks out nothing, so its shell is inline.

## Release flow

1. A push to `main` runs `release.yml`. `select-mode` picks `version`, `publish` or `none`.
2. `version` runs `pnpm run version-packages` and opens the "Version Packages" pull request. `GITHUB_TOKEN` makes it, so CI does not run on it: close and reopen it to run CI. Keep its title, because `ci.yml` skips the changeset check on its merge.
3. `pack` builds the packages and writes the tarballs and `publish-plan.json`, which holds the sha256 of each.
4. `stage` (environment `npm`, no checkout, no repository code) verifies every sha256, then runs `npm stage publish --provenance`. The maintainer approves each package with 2FA: `npm stage approve <id>`.
5. `finalize` waits until every version is live with its provenance attestation, then creates the tags `<name>@<version>` and the GitHub Releases. If it times out, approve what is left and run the workflow with `finalize_only`.

## Also

- `.github/scripts/changeset-check.sh` is the CI changeset gate. `finalize-release.sh` is idempotent: it tags and releases the `packages/*` whose version the release commit bumped. A published package lives in `packages/` and is listed in `fixed` in `.changeset/config.json`.
- `security.yml` keeps Scorecard's rules: no top-level `env` or `defaults`, no OIDC token in another job, only approved actions in its job.
- The workflows assume these repository settings: environment `npm` (only `main`, maintainer approval), Actions allowed to create pull requests, and tag rulesets that let the Actions bot create `*@*` and `@*/*@*` tags.

## Bumping an action

1. Pick the release and read its notes.
2. Resolve its SHA with the command above and read `action.yml` at that SHA.
3. Replace the SHA and the `# vX.Y.Z` comment everywhere: `grep -rn <old sha> .github`.
4. Run `zizmor .github/workflows` and `vp check`.
5. Never use a tag or a branch, and never copy a SHA from a third-party list.
