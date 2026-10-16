# @hollware/admin

## 0.9.1

### Patch Changes

- [`7d86c7f`](https://github.com/hollware/hollware/commit/7d86c7ff6bd375d2a66f8b72648abc74746e84b8) Thanks [@sergioazoc](https://github.com/sergioazoc)! - A page of the admin loaded before a deploy no longer breaks when it asks for a file the new version does not have: it loads the new version, at the page the person was going to (at most once in ten seconds, so a file that is truly missing still shows its error).

## 0.9.0

### Minor Changes

- [`ca25564`](https://github.com/hollware/hollware/commit/ca255645591bd4a12fd857cb4ba42fe92b99414f) Thanks [@sergioazoc](https://github.com/sergioazoc)! - Act on many rows at once: select entries to publish, schedule or unpublish them; reviews to approve them or ask for changes with one note; tokens to revoke them; and people to change their role or remove them from the site. Each runs the operation of one row, a few at a time, and a toast says how many came to each outcome; warnings to accept come back together, to accept at once.

- [`7b56817`](https://github.com/hollware/hollware/commit/7b56817bd7e1c02f90b4106d69882c6a16a5e4d0) Thanks [@sergioazoc](https://github.com/sergioazoc)! - The admin speaks English and Spanish: it starts in the browser's language, and the person menu switches it.

- [`c9ac710`](https://github.com/hollware/hollware/commit/c9ac710464cf19773076c285784cc3300eae2957) Thanks [@sergioazoc](https://github.com/sergioazoc)! - The admin is laid out as Linear lays out a workspace, with Nuxt UI's dashboard: a sidebar that collapses and resizes, with the site to work in at the top (and the sites to switch to), search on ⌘K, the sections with their icons (the reviews that wait counted, the collections of the site one click away), and the person at the foot; each page is a panel beside it, its title and its actions in the bar at the top.

- [`5b594c8`](https://github.com/hollware/hollware/commit/5b594c81c23649ff67f3f7ab91f8293b8af68a69) Thanks [@sergioazoc](https://github.com/sergioazoc)! - Every table of the admin is a data table: a filter, sorting by column and pages of 25 (entries, collections, people, invitations and tokens). The search of ⌘K finds published entries with their snippet, drafts and entries waiting for review, and goes to every page, collection, creation and site.

### Patch Changes

- [`5d2716d`](https://github.com/hollware/hollware/commit/5d2716d64ff3d30280e19e8d01caa70d87e55777) Thanks [@sergioazoc](https://github.com/sergioazoc)! - The admin takes the whole Nuxt UI theme of hollware.com and nothing else: Nuxt UI's own radius (0.25rem, which the theme leaves as it is; 0.5rem was a leftover of the brand before), its own container width, and no pill of its own.

## 0.8.0

### Minor Changes

- [`ed861e0`](https://github.com/hollware/hollware/commit/ed861e0c33e33c24a95c1385d620ff55446f134d) Thanks [@sergioazoc](https://github.com/sergioazoc)! - The admin shapes the site with no deploy (ADR-033): Collections lists them and makes one from a preset (a blog, docs, or a title alone); the editor of a collection edits its fields (kind, bounds, choices, required, order), its paths per locale, the fields of translations, tags and order, its rules from the catalog with their parameters, its style guide and its components, and asks to confirm a change that touches existing entries. Site edits the locales, the public URL, the origins that read from the browser and the style guide, makes a new site, puts this one in the trash and restores one. People gives a member another role or removes them. `/v1/admin/me` lists the trashed sites the person owns.

- [`286149b`](https://github.com/hollware/hollware/commit/286149b7106adb84b5ee02b0433dc780b50be6e3) Thanks [@sergioazoc](https://github.com/sergioazoc)! - Webhooks need no Worker secret of their own (ADR-033): one that names none is signed with a secret Hollware makes with the new operation `make_webhook_secret`, answers once, and keeps sealed in D1 (migration `0012_site_secrets`) under `HOLLWARE_SECRET`, which `hollware deploy` now makes when the Worker has none. The admin's Site adds and removes webhooks and makes their secrets. A site in the trash keeps its rows until it is restored.

### Patch Changes

- [`eaa743d`](https://github.com/hollware/hollware/commit/eaa743d4f6a6cb7ec5977f73379e6f414f43403f) Thanks [@sergioazoc](https://github.com/sergioazoc)! - A new project has no `hollware.config.ts` (ADR-033): the starter's Worker is `createHollware()`, and `hollware init` gives the site its first definition from a preset, `--preset blog|docs|empty` (blog by default) in `--locales` (en by default), which `create-hollware` takes too and hands to it. A project that still has a config keeps it: `init` writes no definition there, and the Worker moves the config into the database on its first request. The presets live in `@hollware/core` (`sitePreset`, `collectionPreset`), shared by the CLI and the admin. The fixes Hollware gives point at the admin and the operations instead of a config file.

## 0.7.0

### Minor Changes

- [`2350777`](https://github.com/hollware/hollware/commit/2350777371cc9ec731214a51a96c9d97303d40fa) Thanks [@sergioazoc](https://github.com/sergioazoc)! - The admin gets a home page (what readers read, what waits for review, unpublished work and the last audit), a list of entries with filters for locale, status and text, paged, with translations and a link to the site, and an editor that unpublishes, schedules and cancels a schedule, validates on demand, edits the frontmatter as a form beside the Markdown, switches between translations, starts a missing one, and shows related entries.

- [`f5fdd3a`](https://github.com/hollware/hollware/commit/f5fdd3a085d56bbcc1ef1277502da7592df59bab) Thanks [@sergioazoc](https://github.com/sergioazoc)! - The admin is dark only, with the theme of hollware.com: Nuxt UI with black as the primary color, emerald, neutral greys, Inter and JetBrains Mono, and subtle inputs. The pages the Worker renders to sign in follow it, dark whatever the device.

## 0.6.0

### Minor Changes

- [`059ecdf`](https://github.com/hollware/hollware/commit/059ecdffdd9d4394918dd594cf855898bf34b6d1) Thanks [@sergioazoc](https://github.com/sergioazoc)! - Comments on reviews. The new tool `comment_review` (`content:write`) adds a comment to a pending review, in the caller's name and with the name its client gave, for the person who decides and for the author; it decides nothing. `list_reviews` answers each review with its comments, oldest first, and the admin's review screen shows them and takes new ones. Migration `0010_review_comments.sql` adds the table.

## 0.5.0

No changes in this release.

## 0.4.0

### Minor Changes

- [`85e70a2`](https://github.com/hollware/hollware/commit/85e70a22adc4b1e256f9a0af57b33ca4ba4a9881) Thanks [@sergioazoc](https://github.com/sergioazoc)! - The admin takes the look of hollware.com: ink greys and a mint accent, Geist and Geist Mono bundled with it, dark by default, and Markdown colors in the editor from the same theme. The sign-in, setup and consent pages of the Worker share it.

- [`43333d3`](https://github.com/hollware/hollware/commit/43333d309843e464c47b20412d2d1d05738c835a) Thanks [@sergioazoc](https://github.com/sergioazoc)! - A deployment serves every site of its config (ADR-027). A personal token, an OAuth grant and an RPC call each act on the one site they name; a person has one passkey and one session for the deployment, with a role per site. The consent page asks which site when the person is in several, the admin switches sites (`GET /v1/admin/me`), and `hollware init --site <key>` on a database with an owner adds the site to that owner. Migration `0006_people_across_sites.sql` drops `site_id` from passkeys, sessions and sign-in challenges.

- [`a7b5f26`](https://github.com/hollware/hollware/commit/a7b5f261d08bf8b58e3dc98ee0a7148de71d394b) Thanks [@sergioazoc](https://github.com/sergioazoc)! - Read tokens and CORS for the read API (ADR-028). A read token (`hw_read_`) reads the published content of one site over `GET /v1/…` and is refused everywhere else; make one with `hollware token create --read` or in the admin. A site lists the origins of its pages in `cors.origins`, and those pages may read it from the browser. Migration `0007_read_tokens.sql` adds the `kind` of a token.

## 0.3.0

### Minor Changes

- [`bf0d98c`](https://github.com/hollware/hollware/commit/bf0d98cf151ddb7ae4167ffa43e92cdd2a1709ae) Thanks [@sergioazoc](https://github.com/sergioazoc)! - The admin's screens. A person signs in with their passkey (the admin is the server's own OAuth client, with PKCE, and keeps its token in memory), lists the entries of a collection, creates a draft from the fields its collection requires, edits the Markdown in CodeMirror with the verdict as diagnostics and the saved revision's HTML beside it, saves, and publishes, acknowledging warnings when asked; without `content:publish`, publishing asks for a review. The review queue shows what is live beside the revision asked for, with its verdict, and approves it or asks for changes. A review now carries `requestedByName`.

- [`56f72c6`](https://github.com/hollware/hollware/commit/56f72c6a71155a05a4ceb9a350bf3f062838bd9f) Thanks [@sergioazoc](https://github.com/sergioazoc)! - The admin's groundwork. The server answers the operations over HTTP at `POST /v1/ops/{name}`, with the input and output of the MCP tool of that name, registers the admin as its own OAuth client (no consent page), and serves the admin at `/admin/` from the Worker's static assets, with a policy that runs only its own scripts. `@hollware/admin` builds a Vue single-page app and exports `adminAssets()`, the directory a project's Vite config serves as its `publicDir`; a project binds its static assets as `ASSETS`.

- [`aefb102`](https://github.com/hollware/hollware/commit/aefb1026078d3e860a7b6731953b8bec3a78d4ab) Thanks [@sergioazoc](https://github.com/sergioazoc)! - Tokens and people in the admin. An owner signed in to the admin makes, lists and revokes personal tokens (a token is shown once, and gets no scope its maker lacks), and invites editors and authors with a link to `/setup`. These are routes of the admin's own (`/v1/admin/…`), not operations: they take only an access token of the admin's client with `schema:admin`, so neither a personal token nor another MCP client can make a token.

### Patch Changes

- [`59a8989`](https://github.com/hollware/hollware/commit/59a898963cbda2cb9bb4bb81bfbec48fa846c286) Thanks [@sergioazoc](https://github.com/sergioazoc)! - The admin passes axe: its colors in light mode reach a contrast of 4.5:1, the line numbers of the editor too, and the two sides of a review's diff are named.

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
