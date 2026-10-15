# Changesets

A changeset is a small Markdown file that says which packages a change affects, by how much (`patch`, `minor` or `major`) and what to tell users. Every change that touches a published package carries one, and CI fails without it.

## Add one

1. Run `pnpm exec changeset`, pick the packages and the bump, and write the sentence that goes in the changelog.
2. Run `vp fmt`. The pre-commit hook does it too: `changeset` writes double quotes in the front matter and the formatter wants single quotes.
3. Commit `.changeset/<name>.md` together with the change.

A change that needs no release (docs, tests, tooling) adds an empty changeset instead: `pnpm exec changeset --empty`.

## Versions

The seven published packages (`@hollware/core`, `@hollware/server`, `@hollware/client`, `@hollware/admin`, `@hollware/nuxt`, `hollware` and `create-hollware`) share one version. A changeset for any of them releases all seven at the same version (`fixed` in `config.json`). Apps, templates and examples are private and never versioned.

## Releasing

Never run `changeset version` or `changeset publish` by hand. Merging to `main` makes the Release workflow open a "Version Packages" pull request. Merging that pull request versions the packages on `main` and publishes nothing: the maintainer promotes the merge commit to the `release` branch, and approving the `npm` environment publishes the packages. The whole flow is in `.github/AGENTS.md`.
