# create-hollware

## 1.0.0-rc.0

No changes in this release.

## 0.11.0

### Minor Changes

- [`069c95f`](https://github.com/hollware/hollware/commit/069c95f1e940ea4f9ac013cac3a69d5ad5d7732d) Thanks [@sergioazoc](https://github.com/sergioazoc)! - An activity log of who did what (ADR-037). Every operation that is not a read, every change of tokens, people and invitations in the admin, sign-in and sign-out, an invitation accepted, an app allowed or revoked, and each scheduled publication write a line: who did it as Hollware verified it (a person, a token, an app, or the deployment), what the client declared apart, the action, its target and its outcome, refusals of a scope included. The log is append-only in D1 (migration `0016_audit_log`). Owners read it on the admin's Activity page and download it as CSV.

  The owner decides what it keeps, in the site's `audit`: `ipAddresses` is `off` by default (`hashed` keeps an HMAC of each address keyed by the site, never the address), and `retentionDays` is `null` by default (forever), or 30 to 3650 days. `hollware init` and `npm create hollware` take `--ip-addresses` and `--audit-retention-days`.

- [`1b3f3a2`](https://github.com/hollware/hollware/commit/1b3f3a27d6f42852fae1761ca34a9269e19f0609) Thanks [@sergioazoc](https://github.com/sergioazoc)! - The routes anyone may call without a token (sign-in and passkeys, OAuth's token and registration endpoints, the beacon) are rate limited per address when the Worker has a Workers Rate Limiting binding, `HOLLWARE_RATE_LIMIT`, which new projects get (60 requests a minute): past it they answer 429 with Retry-After. And the cron trigger drops the expired sessions and the sign-in challenges nobody took, which anyone could make pile up a row a request.

## 0.10.0

### Patch Changes

- [`f21e6f8`](https://github.com/hollware/hollware/commit/f21e6f8e4245d0a2ead778d120e4d2e6c63213d2) Thanks [@sergioazoc](https://github.com/sergioazoc)! - The admin loads less than half the JavaScript it did on its first page (Nuxt UI 4.12 loads the code of a component only on the pages that use it, and its menus, palette and toasts when they open), and its site and person buttons, and the links to translations, are named by what they show. New projects get wrangler 4.151.0 and zod 4.6.7.

## 0.9.1

No changes in this release.

## 0.9.0

No changes in this release.

## 0.8.0

### Minor Changes

- [`eaa743d`](https://github.com/hollware/hollware/commit/eaa743d4f6a6cb7ec5977f73379e6f414f43403f) Thanks [@sergioazoc](https://github.com/sergioazoc)! - A new project has no `hollware.config.ts` (ADR-033): the starter's Worker is `createHollware()`, and `hollware init` gives the site its first definition from a preset, `--preset blog|docs|empty` (blog by default) in `--locales` (en by default), which `create-hollware` takes too and hands to it. A project that still has a config keeps it: `init` writes no definition there, and the Worker moves the config into the database on its first request. The presets live in `@hollware/core` (`sitePreset`, `collectionPreset`), shared by the CLI and the admin. The fixes Hollware gives point at the admin and the operations instead of a config file.

## 0.7.0

No changes in this release.

## 0.6.0

No changes in this release.

## 0.5.0

No changes in this release.

## 0.4.0

### Minor Changes

- [`2b76bb0`](https://github.com/hollware/hollware/commit/2b76bb01979986c7f9ec8bb2b2080bad7c252fcd) Thanks [@sergioazoc](https://github.com/sergioazoc)! - `npm create hollware <dir>` makes a project: the starter, every Hollware package at its own version, `git init`, the install, the local migrations, and the site with its owner and a first token, then the `claude mcp add` line for it. `hollware deploy` deploys to Cloudflare, creating the D1 database, the KV namespace and the queues on the first run and setting the public URL of the Worker, and migrates the remote database. `hollware doctor` checks a project and says what to fix. `hollware migrate --remote` takes no backup of a database that has none of the migrations yet.

### Patch Changes

- [`92ccc02`](https://github.com/hollware/hollware/commit/92ccc02ce181db4f291f543a109cd2bd3bf0d7d1) Thanks [@sergioazoc](https://github.com/sergioazoc)! - A project installs with npm, whose peer check refused Vite+'s core in place of `vite` (the starter now overrides every `vite` with its own), and with pnpm, which refused the build scripts of esbuild and workerd (a pnpm project gets a `pnpm-workspace.yaml` that allows them). A step that fails shows the last 30 lines of what it printed.

## 0.3.0

No changes in this release.

## 0.2.0

No changes in this release.

## 0.1.0

No changes in this release.

## 0.0.2

### Patch Changes

- [`d834e1e`](https://github.com/hollware/hollware/commit/d834e1e6cff6d04795842f0d847af64067f104af) Thanks [@sergioazoc](https://github.com/sergioazoc)! - Releases now ship from the `release` branch and are published directly from CI with provenance, after the maintainer approves the `npm` environment (ADR-015). The packages themselves are unchanged.

## 0.0.1

### Patch Changes

- [`622b862`](https://github.com/hollware/hollware/commit/622b8621227246aec6425471de2b257516cea3e0) Thanks [@sergioazoc](https://github.com/sergioazoc)! - First release: the package skeletons. Nothing is usable yet; this release proves the publishing pipeline end to end.
