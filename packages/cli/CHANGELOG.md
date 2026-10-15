# hollware

## 0.3.0

### Minor Changes

- [`88b921f`](https://github.com/hollware/hollware/commit/88b921fac97aca124cadbe171d4d422d4e318e93) Thanks [@sergioazoc](https://github.com/sergioazoc)! - `hollware import --publish` publishes what it imported as one group (in groups of 100), so entries that link to each other are published together; an entry that stops the group is reported and left out, and the rest is published. The CLI also reads wrangler's JSON past a warning printed before it, which made `hollware init` lose its token. `publish` with a group names the entry that has a warning to acknowledge in `failedEntry`.

- [`736214b`](https://github.com/hollware/hollware/commit/736214b5f8656113a5f52f46e96c328da4ab819e) Thanks [@sergioazoc](https://github.com/sergioazoc)! - Passkeys, invitations and sessions for the admin. The server adds migration `0004_identity.sql` and the `/setup` and `/signin` pages; a person's role in a site is their row of the new `members` table, `owner`, `editor` or `author` (every person with a token becomes a member of its site, a `reviewer` of v0.2 an `author`). `hollware init` prints the owner's link to set up a passkey, and `hollware invite --role editor|author` invites a person.

- [`ee1786b`](https://github.com/hollware/hollware/commit/ee1786be92bf76ff3ef7583763eb4400070dd096) Thanks [@sergioazoc](https://github.com/sergioazoc)! - `hollware invite --owner` prints a setup link for the owner of the site, to set up a passkey: on a deployment made before the admin existed, or on a new device.

- [`777ce1d`](https://github.com/hollware/hollware/commit/777ce1dee559ffa13ad576ab2f60d485097f104b) Thanks [@sergioazoc](https://github.com/sergioazoc)! - Reviews. `publish` needs `content:write`: without `content:publish` it runs the same checks and answers `pending_review`, and a person who may publish answers with the new operations `approve_review`, which publishes the revision in their name, or `request_changes`, with a note; `list_reviews` lists them. A new revision of the entry cancels its pending review. The server adds migration `0005_reviews.sql`. `hollware import --publish` reports `pending_review` for an entry that a token without `content:publish` asked to publish. A schedule made through OAuth now publishes as that client.

### Patch Changes

- Updated dependencies [[`bf0d98c`](https://github.com/hollware/hollware/commit/bf0d98cf151ddb7ae4167ffa43e92cdd2a1709ae), [`2580f76`](https://github.com/hollware/hollware/commit/2580f7658f82a534624b7343b1f1d55e121f6b19), [`30479f5`](https://github.com/hollware/hollware/commit/30479f5402b29b934ce5bc06c8f3d2af3cf1bfdf), [`777ce1d`](https://github.com/hollware/hollware/commit/777ce1dee559ffa13ad576ab2f60d485097f104b)]:
  - @hollware/core@0.3.0

## 0.2.0

### Patch Changes

- Updated dependencies [[`705aabf`](https://github.com/hollware/hollware/commit/705aabf95c83ef7ddb2b2c0b2b633a25f03dabe4), [`24faa62`](https://github.com/hollware/hollware/commit/24faa62acd99f961885adb76fe05813df1d9adcb), [`58b2bb1`](https://github.com/hollware/hollware/commit/58b2bb135ab37f295c4043331f914ba2d3bd78f8)]:
  - @hollware/core@0.2.0

## 0.1.0

### Minor Changes

- [`1660281`](https://github.com/hollware/hollware/commit/1660281f9ea7e048060c4f65801caff9f92ba29a) Thanks [@sergioazoc](https://github.com/sergioazoc)! - v0.1, the core: an agent writes and publishes Markdown over MCP, contracts check every write, and a site reads what is published over a service binding.

  - `@hollware/core`: the config (`defineConfig`, `defineCollection`, `defineComponent`), the contracts and their opt-in factories, the nine operation specs and the Markdown pipeline on Comark.
  - `@hollware/server`: `createHollware(config)`, the Worker with the MCP endpoint behind personal tokens and the read-only `Hollware` entrypoint for sites, and the D1 migrations.
  - `hollware`: the CLI's `init`, `migrate`, `token` and `import`.

### Patch Changes

- Updated dependencies [[`1660281`](https://github.com/hollware/hollware/commit/1660281f9ea7e048060c4f65801caff9f92ba29a)]:
  - @hollware/core@0.1.0

## 0.0.2

### Patch Changes

- [`d834e1e`](https://github.com/hollware/hollware/commit/d834e1e6cff6d04795842f0d847af64067f104af) Thanks [@sergioazoc](https://github.com/sergioazoc)! - Releases now ship from the `release` branch and are published directly from CI with provenance, after the maintainer approves the `npm` environment (ADR-015). The packages themselves are unchanged.

## 0.0.1

### Patch Changes

- [`622b862`](https://github.com/hollware/hollware/commit/622b8621227246aec6425471de2b257516cea3e0) Thanks [@sergioazoc](https://github.com/sergioazoc)! - First release: the package skeletons. Nothing is usable yet; this release proves the publishing pipeline end to end.
