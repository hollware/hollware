# Contributing to Hollware

Thank you for your interest in Hollware. The project is open source from its first commit, and contributions are welcome.

Hollware is **pre-alpha** and is built one stage at a time, following [`PLAN.md`](PLAN.md). Right now the most useful contributions are feedback on the design ([`docs/design.md`](docs/design.md)) and on the decisions ([`docs/adr/`](docs/adr/)), and small, well-tested fixes. For anything larger, open an issue first so we can agree on the approach before you spend time on it.

Everyone taking part is expected to follow the [Code of Conduct](CODE_OF_CONDUCT.md).

## Security issues

**Never report a security vulnerability in a public issue or pull request.** Report it privately, as described in [`SECURITY.md`](SECURITY.md).

## Prerequisites

- **Node.js 24.21.0**, the version pinned in `.node-version`. Any version manager that reads that file will pick it up.
- **pnpm 12**, at the exact version pinned in the `packageManager` field of `package.json` (see the [pnpm installation guide](https://pnpm.io/installation)).
- **jq**, which the tests of the CI scripts run. GitHub's runners have it, and so do most systems: install it with your package manager if `jq --version` fails.

You do not need a Cloudflare account: development and tests run locally. You do not need a global install of [Vite+](https://viteplus.dev) either: the repository depends on it, and the `pnpm exec vp ...` commands below run the installed copy.

## Setup

```bash
git clone https://github.com/hollware/hollware.git
cd hollware
pnpm install
```

Installing also enables the Git pre-commit hook, which formats the staged files and runs the static checks (`vp check`) before every commit. [`AGENTS.md`](AGENTS.md) has a map of the repository.

## Commands

| Command                                                                   | What it does                                                                      |
| ------------------------------------------------------------------------- | --------------------------------------------------------------------------------- |
| `pnpm install`                                                            | Install dependencies (pnpm version comes from `packageManager`)                   |
| `pnpm exec vp check`                                                      | Format, lint and type-check the whole repo                                        |
| `pnpm exec vp test`                                                       | Run every test project; `--project <name>` runs one                               |
| `pnpm exec vp run -r build`                                               | Build every package                                                               |
| `pnpm exec vp run bench`                                                  | Benchmark the Markdown pipeline: fails when a write takes over 3 ms of CPU at p95 |
| `pnpm exec vp run check:push`                                             | Everything CI runs: check, test, bench, build, publint, types                     |
| `node scripts/break-line.ts --file <f> --find <s> --replace <s> -- <cmd>` | Mutation probe: prints `CAUGHT`, `NOT CAUGHT` or `ERROR`                          |

`vp` is Vite+. Always run the copy installed in the repository, through `pnpm exec`: a global `vp` of another version breaks the Cloudflare plugin. `AGENTS.md` writes `vp` as shorthand for `pnpm exec vp`.

## Conventions

- **English everywhere.** Code, comments, commit messages, documentation and issues are written in English.
- **Conventional Commits.** Commit messages and pull request titles follow [Conventional Commits](https://www.conventionalcommits.org): `feat: ...`, `fix: ...`, `docs: ...`, `chore: ...`, with an optional scope such as `fix(cli): ...`.
- **A changeset for every change to a published package.** Run `pnpm exec changeset`, pick the packages and the bump, and write the summary for the people who will read the changelog. Commit the file it creates in `.changeset/` together with your change. Changes that touch no published package, such as docs, tests and tooling, do not need one.
- **Dependencies come from the pnpm catalog.** The catalog in `pnpm-workspace.yaml` pins exact versions, each one published at least 24 hours before it was pinned, and packages refer to them as `catalog:`. Never lower `minimumReleaseAge`. If your change needs a new dependency, say why in the pull request. The routine for updating dependencies is in `AGENTS.md`.
- **Structural decisions are recorded as ADRs.** A change that makes or alters one adds an ADR in `docs/adr/`, whose README has the template.

`AGENTS.md` lists the rest, and lint and the tests enforce most of it: every bare import is declared in the importing package's `package.json`, packages never read `process.env` (configuration arrives as arguments), and a promise is always awaited or explicitly handled, because Workers cancel whatever is left.

## Tests

Read the **Test bar** in [`AGENTS.md`](AGENTS.md) before you write a test. Its core rule: for every test, name the production line that must change for it to fail. If you cannot, the test is tautological, so strengthen it or delete it. There is no coverage threshold. Mutations are the measure.

Check a test with the mutation probe, `scripts/break-line.ts`. It runs a command on the file as it is, then again with one exact snippet replaced, and restores the file byte for byte:

```bash
node scripts/break-line.ts --file <file> --find '<exact snippet>' --replace '<broken version>' -- pnpm exec vp test --project <name>
```

`CAUGHT` means the command passed on the file as it is and failed with the line broken, which is what you want. `NOT CAUGHT` means it passed both ways, so nothing guards that line. `ERROR` means there is no verdict. It covers these cases:

- the snippet was missing or ambiguous;
- the command already fails without the mutation;
- the command could not start, was killed by a signal or ran past the `--timeout` limit;
- the file could not be restored.

The last line the probe prints says which run produced the verdict. Ctrl-C kills the command and whatever it spawned, puts the file back and exits with 130. `--help` lists the options, the default timeout and the exit codes. Read the name of the failing test as well: a `CAUGHT` proves your test only when your test is the one that fails.

## Coding agents

Coding agents read [`AGENTS.md`](AGENTS.md): it orients them in the repository with its layout, commands, conventions and test bar. There is no `CLAUDE.md` and there must never be one. Using an agent to write your change is fine. You stay responsible for it, so read the diff and run the checks before you open the pull request.

## Issues

Use the issue forms. A bug report asks for the Hollware version, where it runs, the steps to reproduce, the expected and the actual behavior, and the logs. A feature request starts from the problem rather than the solution, and says which of the five principles in the [README](README.md) it relates to. Search the existing issues first.

## Pull requests

1. Fork the repository and create a branch from `main`.
2. Make your change, with tests, and a changeset if a published package changed.
3. Run `pnpm exec vp run check:push` locally. It runs the same code checks as CI: check, test, build, publint and types.
4. Open a pull request against `main` and fill in the template.

CI must pass before a pull request can be merged. Keep each pull request to one concern: small changes are reviewed faster. Hollware has a single maintainer, [Sergio Azócar](https://github.com/sergioazoc), so reviews take time. Please be patient.

## Releases

Only the maintainer releases. `main` is where development happens and the branch every pull request targets. `release` is what ships: it only moves by fast-forward to a commit that is on `main`, so never open a pull request against it. The flow, from the Version Packages pull request to the approval of the `npm` environment, is in [`.github/AGENTS.md`](.github/AGENTS.md).

## Licensing

There is no CLA. You keep the copyright on your contribution, and by submitting it you license it under the project's [MIT License](LICENSE).
