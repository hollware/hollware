# @hollware/server

## 0.5.0

### Minor Changes

- [`02b2fe2`](https://github.com/hollware/hollware/commit/02b2fe2afc509bb3fb6a0f0110d1002b50953e26) Thanks [@sergioazoc](https://github.com/sergioazoc)! - Page views without personal data (ADR-031). `POST /events` counts a view that a page of a site sends, as the site, the path and the country, in Analytics Engine through an optional `ANALYTICS` binding; never a cookie, an IP or a user agent. The new tool `content_stats` answers the most read pages of the site over the last days, each with the published entry at its path, read from the SQL API with `HOLLWARE_ANALYTICS_ACCOUNT_ID` and the secret `HOLLWARE_ANALYTICS_TOKEN`. The MCP prompt `refresh_content` walks an agent from what readers read to an updated entry. `@hollware/nuxt` sends the views when its `beacon` option names the Hollware.

- [`0712311`](https://github.com/hollware/hollware/commit/071231163dbf2bb7f5e3368466c5ed0ea5a3c20c) Thanks [@sergioazoc](https://github.com/sergioazoc)! - Full-text search (ADR-029). The operation `search` finds the published entries that hold every word of a query, in their title, tags and text, best first, with a snippet that marks the match; it is a tool over MCP, `GET /v1/search` in the read API, and `search` over RPC and in `@hollware/client`. Migration `0008_search.sql` adds the FTS5 index, kept by triggers in the step that publishes or unpublishes, and indexes what is published already. "migracion" finds "migración".

- [`310b3ab`](https://github.com/hollware/hollware/commit/310b3abbadfe303be1c90e4c5009ef99bc08c8e1) Thanks [@sergioazoc](https://github.com/sergioazoc)! - Semantic and hybrid search (ADR-030). `search` takes a `mode`: `fulltext`, `semantic` (by meaning, in any language) or `hybrid`, the default, which merges both; the answer says which mode ran, and a Worker without semantic search answers full text. `get_entry` takes `related: true` and answers the published entries closest to the entry by meaning, in its collection and locale. Over RPC and `@hollware/client` they are the options `mode` and `related`; over the read API, `GET /v1/search?mode=` and `GET /v1/{collection}/{locale}/{slug}?related=true`.

- [`4746735`](https://github.com/hollware/hollware/commit/474673523edeb3ef2922ba187b33a79c65bd3ab8) Thanks [@sergioazoc](https://github.com/sergioazoc)! - The embedding model is the Worker variable `HOLLWARE_EMBEDDING_MODEL` (`@cf/baai/bge-m3` when not set); its Vectorize index must have been made for its dimensions. `HollwareEnv` takes the `VectorizeIndex` type that `wrangler types` writes for a Vectorize binding. The read API says how long a read took on the server, after the token check, in `Server-Timing: read;dur=<ms>`.

- [`b84107c`](https://github.com/hollware/hollware/commit/b84107c9d0dd0d60d9521c7314a030cf4ab0cc67) Thanks [@sergioazoc](https://github.com/sergioazoc)! - Vectors as derived data (ADR-030). A Worker with an `AI` (Workers AI) and a `VECTORIZE` binding embeds every published entry, one vector for its summary and one for each section (`chunksOf` in `@hollware/core`), and keeps them in line with what is published: an internal `vectors` subscriber follows each publish and unpublish, and the cron trigger indexes what no event did, such as entries published before the bindings were added. Migration `0009_embeddings.sql` records which revision, model and chunker each entry's vectors come from. A Worker without those bindings is unchanged.

### Patch Changes

- [`310b3ab`](https://github.com/hollware/hollware/commit/310b3abbadfe303be1c90e4c5009ef99bc08c8e1) Thanks [@sergioazoc](https://github.com/sergioazoc)! - The read API answers an input the caller got wrong with its code and status again: an unknown collection or locale is a 404, a limit out of range a 400. Since the move to Hono 5 they were answered as a 500, because the app's error handler took the error before the read API could.

- [`0942b0b`](https://github.com/hollware/hollware/commit/0942b0b04b400d1f133ab5b21bcd86c7a906276b) Thanks [@sergioazoc](https://github.com/sergioazoc)! - Related entries are found again by the cron trigger: for an entry whose list is empty after ten minutes (entries indexed together miss each other while Vectorize applies their vectors), and for every entry once a day, so that an entry published later shows up among the related entries of those before it.
- Updated dependencies [[`02b2fe2`](https://github.com/hollware/hollware/commit/02b2fe2afc509bb3fb6a0f0110d1002b50953e26), [`0712311`](https://github.com/hollware/hollware/commit/071231163dbf2bb7f5e3368466c5ed0ea5a3c20c), [`310b3ab`](https://github.com/hollware/hollware/commit/310b3abbadfe303be1c90e4c5009ef99bc08c8e1), [`b84107c`](https://github.com/hollware/hollware/commit/b84107c9d0dd0d60d9521c7314a030cf4ab0cc67)]:
  - @hollware/core@0.5.0

## 0.4.0

### Minor Changes

- [`43333d3`](https://github.com/hollware/hollware/commit/43333d309843e464c47b20412d2d1d05738c835a) Thanks [@sergioazoc](https://github.com/sergioazoc)! - A deployment serves every site of its config (ADR-027). A personal token, an OAuth grant and an RPC call each act on the one site they name; a person has one passkey and one session for the deployment, with a role per site. The consent page asks which site when the person is in several, the admin switches sites (`GET /v1/admin/me`), and `hollware init --site <key>` on a database with an owner adds the site to that owner. Migration `0006_people_across_sites.sql` drops `site_id` from passkeys, sessions and sign-in challenges.

- [`a7b5f26`](https://github.com/hollware/hollware/commit/a7b5f261d08bf8b58e3dc98ee0a7148de71d394b) Thanks [@sergioazoc](https://github.com/sergioazoc)! - Read tokens and CORS for the read API (ADR-028). A read token (`hw_read_`) reads the published content of one site over `GET /v1/…` and is refused everywhere else; make one with `hollware token create --read` or in the admin. A site lists the origins of its pages in `cors.origins`, and those pages may read it from the browser. Migration `0007_read_tokens.sql` adds the `kind` of a token.

### Patch Changes

- [`85e70a2`](https://github.com/hollware/hollware/commit/85e70a22adc4b1e256f9a0af57b33ca4ba4a9881) Thanks [@sergioazoc](https://github.com/sergioazoc)! - The admin takes the look of hollware.com: ink greys and a mint accent, Geist and Geist Mono bundled with it, dark by default, and Markdown colors in the editor from the same theme. The sign-in, setup and consent pages of the Worker share it.
- Updated dependencies [[`43333d3`](https://github.com/hollware/hollware/commit/43333d309843e464c47b20412d2d1d05738c835a), [`a7b5f26`](https://github.com/hollware/hollware/commit/a7b5f261d08bf8b58e3dc98ee0a7148de71d394b)]:
  - @hollware/core@0.4.0

## 0.3.0

### Minor Changes

- [`bf0d98c`](https://github.com/hollware/hollware/commit/bf0d98cf151ddb7ae4167ffa43e92cdd2a1709ae) Thanks [@sergioazoc](https://github.com/sergioazoc)! - The admin's screens. A person signs in with their passkey (the admin is the server's own OAuth client, with PKCE, and keeps its token in memory), lists the entries of a collection, creates a draft from the fields its collection requires, edits the Markdown in CodeMirror with the verdict as diagnostics and the saved revision's HTML beside it, saves, and publishes, acknowledging warnings when asked; without `content:publish`, publishing asks for a review. The review queue shows what is live beside the revision asked for, with its verdict, and approves it or asks for changes. A review now carries `requestedByName`.

- [`56f72c6`](https://github.com/hollware/hollware/commit/56f72c6a71155a05a4ceb9a350bf3f062838bd9f) Thanks [@sergioazoc](https://github.com/sergioazoc)! - The admin's groundwork. The server answers the operations over HTTP at `POST /v1/ops/{name}`, with the input and output of the MCP tool of that name, registers the admin as its own OAuth client (no consent page), and serves the admin at `/admin/` from the Worker's static assets, with a policy that runs only its own scripts. `@hollware/admin` builds a Vue single-page app and exports `adminAssets()`, the directory a project's Vite config serves as its `publicDir`; a project binds its static assets as `ASSETS`.

- [`aefb102`](https://github.com/hollware/hollware/commit/aefb1026078d3e860a7b6731953b8bec3a78d4ab) Thanks [@sergioazoc](https://github.com/sergioazoc)! - Tokens and people in the admin. An owner signed in to the admin makes, lists and revokes personal tokens (a token is shown once, and gets no scope its maker lacks), and invites editors and authors with a link to `/setup`. These are routes of the admin's own (`/v1/admin/…`), not operations: they take only an access token of the admin's client with `schema:admin`, so neither a personal token nor another MCP client can make a token.

- [`2580f76`](https://github.com/hollware/hollware/commit/2580f7658f82a534624b7343b1f1d55e121f6b19) Thanks [@sergioazoc](https://github.com/sergioazoc)! - `get_entry` takes `published: true` to read the revision that is live instead of the latest one, as a reviewer compares them.

- [`736214b`](https://github.com/hollware/hollware/commit/736214b5f8656113a5f52f46e96c328da4ab819e) Thanks [@sergioazoc](https://github.com/sergioazoc)! - Passkeys, invitations and sessions for the admin. The server adds migration `0004_identity.sql` and the `/setup` and `/signin` pages; a person's role in a site is their row of the new `members` table, `owner`, `editor` or `author` (every person with a token becomes a member of its site, a `reviewer` of v0.2 an `author`). `hollware init` prints the owner's link to set up a passkey, and `hollware invite --role editor|author` invites a person.

- [`30479f5`](https://github.com/hollware/hollware/commit/30479f5402b29b934ce5bc06c8f3d2af3cf1bfdf) Thanks [@sergioazoc](https://github.com/sergioazoc)! - The OAuth server of ADR-026. `/mcp` and `/v1` are OAuth protected resources: a request without a token gets a 401 whose challenge names their metadata, and MCP clients that speak OAuth, such as claude.ai, sign in through `/authorize`, where a person with a passkey allows them the scopes their role has. Personal tokens work as before. A project needs a KV namespace bound as `OAUTH_KV` and the `global_fetch_strictly_public` compatibility flag; `auth: { dynamicClientRegistration: true }` in the config lets clients register themselves.

- [`777ce1d`](https://github.com/hollware/hollware/commit/777ce1dee559ffa13ad576ab2f60d485097f104b) Thanks [@sergioazoc](https://github.com/sergioazoc)! - Reviews. `publish` needs `content:write`: without `content:publish` it runs the same checks and answers `pending_review`, and a person who may publish answers with the new operations `approve_review`, which publishes the revision in their name, or `request_changes`, with a note; `list_reviews` lists them. A new revision of the entry cancels its pending review. The server adds migration `0005_reviews.sql`. `hollware import --publish` reports `pending_review` for an entry that a token without `content:publish` asked to publish. A schedule made through OAuth now publishes as that client.

### Patch Changes

- [`88b921f`](https://github.com/hollware/hollware/commit/88b921fac97aca124cadbe171d4d422d4e318e93) Thanks [@sergioazoc](https://github.com/sergioazoc)! - `hollware import --publish` publishes what it imported as one group (in groups of 100), so entries that link to each other are published together; an entry that stops the group is reported and left out, and the rest is published. The CLI also reads wrangler's JSON past a warning printed before it, which made `hollware init` lose its token. `publish` with a group names the entry that has a warning to acknowledge in `failedEntry`.
- Updated dependencies [[`bf0d98c`](https://github.com/hollware/hollware/commit/bf0d98cf151ddb7ae4167ffa43e92cdd2a1709ae), [`2580f76`](https://github.com/hollware/hollware/commit/2580f7658f82a534624b7343b1f1d55e121f6b19), [`30479f5`](https://github.com/hollware/hollware/commit/30479f5402b29b934ce5bc06c8f3d2af3cf1bfdf), [`777ce1d`](https://github.com/hollware/hollware/commit/777ce1dee559ffa13ad576ab2f60d485097f104b)]:
  - @hollware/core@0.3.0

## 0.2.0

### Minor Changes

- [`705aabf`](https://github.com/hollware/hollware/commit/705aabf95c83ef7ddb2b2c0b2b633a25f03dabe4) Thanks [@sergioazoc](https://github.com/sergioazoc)! - Publication events (ADR-025): a publish or an unpublish writes its event to an outbox in the same batch, and the Worker delivers it from a Queue (its new `queue` handler) or, without one, from the cron trigger: to the webhooks of the site, signed with HMAC-SHA256 (`signWebhook` and `verifyWebhook` in `@hollware/core`), and to IndexNow. Each subscriber gets each event once; a failure is retried and ends in the dead-letter queue. A site declares its `url` and its `events` in the config.

- [`24faa62`](https://github.com/hollware/hollware/commit/24faa62acd99f961885adb76fe05813df1d9adcb) Thanks [@sergioazoc](https://github.com/sergioazoc)! - `publish` takes a `group` of other entries to publish in the same step, all or none (ADR-024): links between the entries of the group count as published, so entries that link to each other can be published together, and a refusal names the entry that stopped the group in `failedEntry`.

- [`ac2937b`](https://github.com/hollware/hollware/commit/ac2937bafc0cf5b6f1020af96d8873e3c32d9a00) Thanks [@sergioazoc](https://github.com/sergioazoc)! - The HTTP read API at `/v1`: the four read methods of the RPC binding, over published content, for a personal token with `content:read`, with ETags (304) and an OpenAPI 3.1 document at `/v1/openapi.json`. `@hollware/client` reads a Hollware over a service binding or over HTTP with one interface, and re-exports `verifyWebhook`.

- [`58b2bb1`](https://github.com/hollware/hollware/commit/58b2bb135ab37f295c4043331f914ba2d3bd78f8) Thanks [@sergioazoc](https://github.com/sergioazoc)! - `publish` takes `publishAt` to schedule a publication (ADR-025): the entry is checked now and waits as `scheduled`, and the Worker's new `scheduled` handler, run by a cron trigger every minute, publishes it at its time in the name of who scheduled it. A change after scheduling, or `unpublish`, takes it back to a draft. The migration `0003_events_and_schedules.sql` adds the tables of schedules and of the outbox of v0.2.

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
