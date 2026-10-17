# @hollware/core

## 0.10.0

### Minor Changes

- [`eb4df6d`](https://github.com/hollware/hollware/commit/eb4df6dd3a8eafc7b04266478a2f0950adea0bbc) Thanks [@sergioazoc](https://github.com/sergioazoc)! - Entries have a trash: `delete_entry` moves a draft there and cancels its pending review, `restore_entry` brings it back as the draft it was, `list_entries` lists it with `trashed: true`, every summary carries `deletedAt`, `create_draft` answers `in_trash` for the slug a trashed entry keeps, migration `0014_entry_trash` adds the column, and the admin trashes a draft from the editor and lists, trashes and restores entries in bulk under the filter "In the trash".

- [`6a8e7b5`](https://github.com/hollware/hollware/commit/6a8e7b57f894722d808f1708b353884ad2f0a6d7) Thanks [@sergioazoc](https://github.com/sergioazoc)! - The events of webhooks are a schema of `@hollware/core` now: `hollwareEvent` (with `entryEvent` and `siteEvent`, and their types), and `parseHollwareEvent(body)`, which reads the body of a webhook once its signature holds, and answers null for a body that is no event this version knows.

- [`ad56b86`](https://github.com/hollware/hollware/commit/ad56b8656041396926ab9b1de602cf15519a5f38) Thanks [@sergioazoc](https://github.com/sergioazoc)! - Security: a site's definition can no longer send a secret of the Worker out. IndexNow's `key` is the key itself now, which is public (8 to 128 letters, digits or hyphens; `INDEXNOW_KEY`), not the name of a Worker secret, and a webhook may not name a secret of Hollware or of Cloudflare (`HOLLWARE_*`, `CLOUDFLARE_*`, `CF_*`). Before, an owner of one site, or an agent with `schema:admin`, could name `HOLLWARE_SECRET` as an IndexNow key and have its value sent to IndexNow. A stored definition of the old form is served with IndexNow off, and logs `indexnow_off`; set the key itself to turn it on. The sign-in page also goes back only to a page of its own origin: a `return_to` such as `/\evil.example` could send a person to another host after their passkey.

- [`75341bf`](https://github.com/hollware/hollware/commit/75341bf1134084e2ac8b316a661ee46fe863b1ca) Thanks [@sergioazoc](https://github.com/sergioazoc)! - A change of a site's structure is an event too: `site.changed`, sent to the site's webhooks with the cache tags it invalidates (`site`, and every list of the collections and locales the site had or has, `tagsOfSiteChange`), so a site that caches its pages purges its navigation and lists when a collection, a route or a locale changes, with no publish. The event carries no entry, and IndexNow is not told of it. Migration `0013_site_events` rebuilds the outbox to take it, keeping every event and delivery.

## 0.9.1

No changes in this release.

## 0.9.0

No changes in this release.

## 0.8.0

### Minor Changes

- [`501174a`](https://github.com/hollware/hollware/commit/501174a4b9cd7e0a5191fa587c09e39f71ff3bd7) Thanks [@sergioazoc](https://github.com/sergioazoc)! - Cache tags are part of the contract: `entryTag`, `listTag`, `groupTag`, `SITE_TAG`, `tagsOfEntries` and `tagsOfChange` of `@hollware/core` name what a page shows, and every event's payload carries `cacheTags`, the tags the change invalidates (the entry, the list of its collection in its locale, its translations), for a site to purge.

- [`eaa743d`](https://github.com/hollware/hollware/commit/eaa743d4f6a6cb7ec5977f73379e6f414f43403f) Thanks [@sergioazoc](https://github.com/sergioazoc)! - A new project has no `hollware.config.ts` (ADR-033): the starter's Worker is `createHollware()`, and `hollware init` gives the site its first definition from a preset, `--preset blog|docs|empty` (blog by default) in `--locales` (en by default), which `create-hollware` takes too and hands to it. A project that still has a config keeps it: `init` writes no definition there, and the Worker moves the config into the database on its first request. The presets live in `@hollware/core` (`sitePreset`, `collectionPreset`), shared by the CLI and the admin. The fixes Hollware gives point at the admin and the operations instead of a config file.

- [`f2f2c3d`](https://github.com/hollware/hollware/commit/f2f2c3d6ac6123d26bc1bc0d2b668b61d42afd9d) Thanks [@sergioazoc](https://github.com/sergioazoc)! - The sites live in D1 (ADR-033). Migration `0011_structure` gives `sites` a definition, a version and `deleted_at`, and adds `site_changes`. The Worker reads the sites from D1 through a registry that polls their versions at most once a second per isolate and compiles again only a site that changed, keeping the last good copy of one that stops compiling. `createHollware()` takes no config; a 0.x config, when given, moves into D1 on the first request for the sites that have no definition, and is never read again. `HollwareConfig.sites` is optional, so `createHollware({ auth })` sets the options of the deployment alone.

- [`d1ea96e`](https://github.com/hollware/hollware/commit/d1ea96e61df8a7b58e0a9b5e76b85abdddc78a7a) Thanks [@sergioazoc](https://github.com/sergioazoc)! - A site's structure can be data (ADR-033): `siteDefinitionData` describes a site, its collections with JSON Schemas, components and rules, and `compileSites` resolves definitions into the sites the server reads, frontmatter validated with `@cfworker/json-schema`. Rules come from a catalog with parameters (`CATALOG`, `describeCatalog`), which adds `contracts.fieldLength`, `contracts.fieldPattern`, `contracts.requiredToPublish` and `contracts.bannedWords`; built-in factories take an `id`. `definitionsFromConfig` moves a 0.x config into definitions, keeping every verdict's hash.

- [`3f3cb16`](https://github.com/hollware/hollware/commit/3f3cb16b9779defecc14c95b6607989a3dd22367) Thanks [@sergioazoc](https://github.com/sergioazoc)! - Six operations change the structure of the sites with no deploy (ADR-033), under the scope `schema:admin` that owners have: `get_structure` reads the definition, its version and the catalog of rules; `update_site` and `set_collection` replace the definition or one collection at the version read, answering every problem at its path, and asking to confirm a change that strands entries (a removed collection or locale) or that a new schema refuses (with counts and slugs); `create_site` makes a site with its maker as owner; `delete_site` puts a site its owner confirms in the trash, and `restore_site` brings it back. Every change is appended to `site_changes` with its actor, and the Worker serves it at once.

- [`286149b`](https://github.com/hollware/hollware/commit/286149b7106adb84b5ee02b0433dc780b50be6e3) Thanks [@sergioazoc](https://github.com/sergioazoc)! - Webhooks need no Worker secret of their own (ADR-033): one that names none is signed with a secret Hollware makes with the new operation `make_webhook_secret`, answers once, and keeps sealed in D1 (migration `0012_site_secrets`) under `HOLLWARE_SECRET`, which `hollware deploy` now makes when the Worker has none. The admin's Site adds and removes webhooks and makes their secrets. A site in the trash keeps its rows until it is restored.

## 0.7.0

### Minor Changes

- [`e43c814`](https://github.com/hollware/hollware/commit/e43c81420272ed1a0835ec681df11ac4cc259539) Thanks [@sergioazoc](https://github.com/sergioazoc)! - An entry's summary says when a scheduled entry will be published (`scheduledAt`), and `describe_site` gives the public origin of the site (`url`), so that a client can link an entry to its page.

## 0.6.0

### Minor Changes

- [`30339e0`](https://github.com/hollware/hollware/commit/30339e000c290ddbceab88161be35ef071ccbe0e) Thanks [@sergioazoc](https://github.com/sergioazoc)! - `@hollware/agents` (ADR-032): a reviewer that comments once on each pending review, a translator that drafts the missing translation of a published entry, fixes what the contracts refuse and asks for its review, and a weekly auditor that reports old but much-read entries and published entries the contracts refuse now, as a draft and optionally to a webhook such as Slack's. They run on a Worker of their own made by `createHollwareAgents`, reach Hollware over MCP with a personal token, and never publish: their client refuses every tool that publishes or decides. The new tool `request_review` asks for a review after the same checks as `publish` and never publishes, whatever the caller's scopes.

- [`059ecdf`](https://github.com/hollware/hollware/commit/059ecdffdd9d4394918dd594cf855898bf34b6d1) Thanks [@sergioazoc](https://github.com/sergioazoc)! - Comments on reviews. The new tool `comment_review` (`content:write`) adds a comment to a pending review, in the caller's name and with the name its client gave, for the person who decides and for the author; it decides nothing. `list_reviews` answers each review with its comments, oldest first, and the admin's review screen shows them and takes new ones. Migration `0010_review_comments.sql` adds the table.

## 0.5.0

### Minor Changes

- [`02b2fe2`](https://github.com/hollware/hollware/commit/02b2fe2afc509bb3fb6a0f0110d1002b50953e26) Thanks [@sergioazoc](https://github.com/sergioazoc)! - Page views without personal data (ADR-031). `POST /events` counts a view that a page of a site sends, as the site, the path and the country, in Analytics Engine through an optional `ANALYTICS` binding; never a cookie, an IP or a user agent. The new tool `content_stats` answers the most read pages of the site over the last days, each with the published entry at its path, read from the SQL API with `HOLLWARE_ANALYTICS_ACCOUNT_ID` and the secret `HOLLWARE_ANALYTICS_TOKEN`. The MCP prompt `refresh_content` walks an agent from what readers read to an updated entry. `@hollware/nuxt` sends the views when its `beacon` option names the Hollware.

- [`0712311`](https://github.com/hollware/hollware/commit/071231163dbf2bb7f5e3368466c5ed0ea5a3c20c) Thanks [@sergioazoc](https://github.com/sergioazoc)! - Full-text search (ADR-029). The operation `search` finds the published entries that hold every word of a query, in their title, tags and text, best first, with a snippet that marks the match; it is a tool over MCP, `GET /v1/search` in the read API, and `search` over RPC and in `@hollware/client`. Migration `0008_search.sql` adds the FTS5 index, kept by triggers in the step that publishes or unpublishes, and indexes what is published already. "migracion" finds "migración".

- [`310b3ab`](https://github.com/hollware/hollware/commit/310b3abbadfe303be1c90e4c5009ef99bc08c8e1) Thanks [@sergioazoc](https://github.com/sergioazoc)! - Semantic and hybrid search (ADR-030). `search` takes a `mode`: `fulltext`, `semantic` (by meaning, in any language) or `hybrid`, the default, which merges both; the answer says which mode ran, and a Worker without semantic search answers full text. `get_entry` takes `related: true` and answers the published entries closest to the entry by meaning, in its collection and locale. Over RPC and `@hollware/client` they are the options `mode` and `related`; over the read API, `GET /v1/search?mode=` and `GET /v1/{collection}/{locale}/{slug}?related=true`.

- [`b84107c`](https://github.com/hollware/hollware/commit/b84107c9d0dd0d60d9521c7314a030cf4ab0cc67) Thanks [@sergioazoc](https://github.com/sergioazoc)! - Vectors as derived data (ADR-030). A Worker with an `AI` (Workers AI) and a `VECTORIZE` binding embeds every published entry, one vector for its summary and one for each section (`chunksOf` in `@hollware/core`), and keeps them in line with what is published: an internal `vectors` subscriber follows each publish and unpublish, and the cron trigger indexes what no event did, such as entries published before the bindings were added. Migration `0009_embeddings.sql` records which revision, model and chunker each entry's vectors come from. A Worker without those bindings is unchanged.

## 0.4.0

### Minor Changes

- [`43333d3`](https://github.com/hollware/hollware/commit/43333d309843e464c47b20412d2d1d05738c835a) Thanks [@sergioazoc](https://github.com/sergioazoc)! - A deployment serves every site of its config (ADR-027). A personal token, an OAuth grant and an RPC call each act on the one site they name; a person has one passkey and one session for the deployment, with a role per site. The consent page asks which site when the person is in several, the admin switches sites (`GET /v1/admin/me`), and `hollware init --site <key>` on a database with an owner adds the site to that owner. Migration `0006_people_across_sites.sql` drops `site_id` from passkeys, sessions and sign-in challenges.

- [`a7b5f26`](https://github.com/hollware/hollware/commit/a7b5f261d08bf8b58e3dc98ee0a7148de71d394b) Thanks [@sergioazoc](https://github.com/sergioazoc)! - Read tokens and CORS for the read API (ADR-028). A read token (`hw_read_`) reads the published content of one site over `GET /v1/…` and is refused everywhere else; make one with `hollware token create --read` or in the admin. A site lists the origins of its pages in `cors.origins`, and those pages may read it from the browser. Migration `0007_read_tokens.sql` adds the `kind` of a token.

## 0.3.0

### Minor Changes

- [`bf0d98c`](https://github.com/hollware/hollware/commit/bf0d98cf151ddb7ae4167ffa43e92cdd2a1709ae) Thanks [@sergioazoc](https://github.com/sergioazoc)! - The admin's screens. A person signs in with their passkey (the admin is the server's own OAuth client, with PKCE, and keeps its token in memory), lists the entries of a collection, creates a draft from the fields its collection requires, edits the Markdown in CodeMirror with the verdict as diagnostics and the saved revision's HTML beside it, saves, and publishes, acknowledging warnings when asked; without `content:publish`, publishing asks for a review. The review queue shows what is live beside the revision asked for, with its verdict, and approves it or asks for changes. A review now carries `requestedByName`.

- [`2580f76`](https://github.com/hollware/hollware/commit/2580f7658f82a534624b7343b1f1d55e121f6b19) Thanks [@sergioazoc](https://github.com/sergioazoc)! - `get_entry` takes `published: true` to read the revision that is live instead of the latest one, as a reviewer compares them.

- [`30479f5`](https://github.com/hollware/hollware/commit/30479f5402b29b934ce5bc06c8f3d2af3cf1bfdf) Thanks [@sergioazoc](https://github.com/sergioazoc)! - The OAuth server of ADR-026. `/mcp` and `/v1` are OAuth protected resources: a request without a token gets a 401 whose challenge names their metadata, and MCP clients that speak OAuth, such as claude.ai, sign in through `/authorize`, where a person with a passkey allows them the scopes their role has. Personal tokens work as before. A project needs a KV namespace bound as `OAUTH_KV` and the `global_fetch_strictly_public` compatibility flag; `auth: { dynamicClientRegistration: true }` in the config lets clients register themselves.

- [`777ce1d`](https://github.com/hollware/hollware/commit/777ce1dee559ffa13ad576ab2f60d485097f104b) Thanks [@sergioazoc](https://github.com/sergioazoc)! - Reviews. `publish` needs `content:write`: without `content:publish` it runs the same checks and answers `pending_review`, and a person who may publish answers with the new operations `approve_review`, which publishes the revision in their name, or `request_changes`, with a note; `list_reviews` lists them. A new revision of the entry cancels its pending review. The server adds migration `0005_reviews.sql`. `hollware import --publish` reports `pending_review` for an entry that a token without `content:publish` asked to publish. A schedule made through OAuth now publishes as that client.

## 0.2.0

### Minor Changes

- [`705aabf`](https://github.com/hollware/hollware/commit/705aabf95c83ef7ddb2b2c0b2b633a25f03dabe4) Thanks [@sergioazoc](https://github.com/sergioazoc)! - Publication events (ADR-025): a publish or an unpublish writes its event to an outbox in the same batch, and the Worker delivers it from a Queue (its new `queue` handler) or, without one, from the cron trigger: to the webhooks of the site, signed with HMAC-SHA256 (`signWebhook` and `verifyWebhook` in `@hollware/core`), and to IndexNow. Each subscriber gets each event once; a failure is retried and ends in the dead-letter queue. A site declares its `url` and its `events` in the config.

- [`24faa62`](https://github.com/hollware/hollware/commit/24faa62acd99f961885adb76fe05813df1d9adcb) Thanks [@sergioazoc](https://github.com/sergioazoc)! - `publish` takes a `group` of other entries to publish in the same step, all or none (ADR-024): links between the entries of the group count as published, so entries that link to each other can be published together, and a refusal names the entry that stopped the group in `failedEntry`.

- [`58b2bb1`](https://github.com/hollware/hollware/commit/58b2bb135ab37f295c4043331f914ba2d3bd78f8) Thanks [@sergioazoc](https://github.com/sergioazoc)! - `publish` takes `publishAt` to schedule a publication (ADR-025): the entry is checked now and waits as `scheduled`, and the Worker's new `scheduled` handler, run by a cron trigger every minute, publishes it at its time in the name of who scheduled it. A change after scheduling, or `unpublish`, takes it back to a draft. The migration `0003_events_and_schedules.sql` adds the tables of schedules and of the outbox of v0.2.

## 0.1.0

### Minor Changes

- [`1660281`](https://github.com/hollware/hollware/commit/1660281f9ea7e048060c4f65801caff9f92ba29a) Thanks [@sergioazoc](https://github.com/sergioazoc)! - v0.1, the core: an agent writes and publishes Markdown over MCP, contracts check every write, and a site reads what is published over a service binding.

  - `@hollware/core`: the config (`defineConfig`, `defineCollection`, `defineComponent`), the contracts and their opt-in factories, the nine operation specs and the Markdown pipeline on Comark.
  - `@hollware/server`: `createHollware(config)`, the Worker with the MCP endpoint behind personal tokens and the read-only `Hollware` entrypoint for sites, and the D1 migrations.
  - `hollware`: the CLI's `init`, `migrate`, `token` and `import`.

## 0.0.2

### Patch Changes

- [`d834e1e`](https://github.com/hollware/hollware/commit/d834e1e6cff6d04795842f0d847af64067f104af) Thanks [@sergioazoc](https://github.com/sergioazoc)! - Releases now ship from the `release` branch and are published directly from CI with provenance, after the maintainer approves the `npm` environment (ADR-015). The packages themselves are unchanged.

## 0.0.1

### Patch Changes

- [`622b862`](https://github.com/hollware/hollware/commit/622b8621227246aec6425471de2b257516cea3e0) Thanks [@sergioazoc](https://github.com/sergioazoc)! - First release: the package skeletons. Nothing is usable yet; this release proves the publishing pipeline end to end.
