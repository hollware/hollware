# @hollware/core

## 1.0.0-rc.6

No changes in this release.

## 1.0.0-rc.5

### Minor Changes

- [`88965e8`](https://github.com/hollware/hollware/commit/88965e8b3431656e939056cc8cfb7ec0b4206072) Thanks [@sergioazoc](https://github.com/sergioazoc)! - Components to render entries in every framework:

  - `<HollwareImage>` in React, Vue and Nuxt renders the image a frontmatter field holds (a cover) with its alt, its size and the `srcset` of its copies; `imageOf(entry, field)` of `@hollware/client` gives the same attributes for any other renderer. The `images` of a summary carry the alt of each image.
  - `@hollware/astro` exports `HollwareContent.astro`, which renders an entry from its document with the site's own Astro components (`components={{ callout: Callout }}`), through the same rules as the HTML Hollware makes, and `HollwareImage.astro`. Its loaders keep the document and the images of each entry for them.
  - `safeDocument` of `@hollware/core` copies a document through the rules of `renderHtml`, for a renderer of a site's own.

## 1.0.0-rc.4

### Minor Changes

- [`9e93f74`](https://github.com/hollware/hollware/commit/9e93f740a5d3c5fd68d16ea43b2ec79853ab1ee6) Thanks [@sergioazoc](https://github.com/sergioazoc)! - The reading time counts the code a reader reads: the pipeline counts the words of code blocks apart (`codeWords`), each revision keeps them (migration `0022`, filled for older revisions by the reparse of the cron, as `PIPELINE_VERSION` 3 marks them), and `readingTime` of `automaticFields` is the words and the words of code at 200 a minute. `wordCount` stays the words of the text.

## 1.0.0-rc.3

### Minor Changes

- [`f31b9fb`](https://github.com/hollware/hollware/commit/f31b9fbbd99f08ab8d094742813f62dc32834d44) Thanks [@sergioazoc](https://github.com/sergioazoc)! - Fields Hollware fills itself: a collection's `automaticFields` names them and how, `firstPublished` (the date an entry first went out; a date written wins), `lastModified` (the date of a change published after that), `readingTime` (minutes at 200 words a minute) and `wordCount`. Nobody writes them: they are never required, `describe_site` marks them `readOnly`, and the admin's entry form leaves them out. A site reads them filled (RPC, the read API, `createHollware()`), `get_entry` answers their values as `automatic`, and `hollware export --published` writes them into the frontmatter; the Markdown stored stays what was written. The admin chooses them per field on the page of a collection, and a new blog fills its `date`.

- [`83f582a`](https://github.com/hollware/hollware/commit/83f582ab6e2483fe94ba7d3953b3b968835443c7) Thanks [@sergioazoc](https://github.com/sergioazoc)! - The daily backups of a site are configurable: `backups` of its definition turns them off (`enabled: false`) or keeps each one from 1 to 365 days (`retentionDays`, 30 by default), over MCP with `update_site` or in the admin under Site → Backups. A site that turns them off gets no new backup, and the ones it kept go when their retention passes. Backups hold the content only, never the images, which are in the bucket already.

- [`0235865`](https://github.com/hollware/hollware/commit/0235865719899057dc58f7888208c16f1e990eda) Thanks [@sergioazoc](https://github.com/sergioazoc)! - Daily backups of each site to R2: after 03:00 UTC the cron writes `backups/<site>/<date>.json` to the bucket `MEDIA`, with the definition of the site and every entry, its latest Markdown and the published one, and keeps 30 days. `list_backups` (MCP and the admin's Site page) lists them, `GET /v1/backups/<date>` downloads one with `schema:admin`, and `hollware backup list` and `hollware backup get <date> <dir> [--published]` turn one back into the files `hollware import` reads.

- [`0075a00`](https://github.com/hollware/hollware/commit/0075a0089e21f378c2295b4f26f5626e866bad67) Thanks [@sergioazoc](https://github.com/sergioazoc)! - What people can change, and a way to say no:

  - `reject_review` closes a pending review as `rejected`, with the reason: unlike `request_changes`, it does not ask for another try. The admin's Reviews page has Reject beside Ask for changes. Migration `0021` lets a review be rejected.
  - `update_asset` changes the alt of an image (the admin's Images page edits it). An image of the site written with no alt of its own takes its asset's when a site reads it, and `images-have-alt` no longer flags it.
  - A person changes their own name, and the labels of their passkeys, under Account; nobody else can change them.

- [`29e7ecc`](https://github.com/hollware/hollware/commit/29e7ecc893fcb5f145e53b99a7f158b518e423f3) Thanks [@sergioazoc](https://github.com/sergioazoc)! - `media.keepOriginals` (true by default): a site that sets it to `false` keeps only the file it serves and its copies, not the file as it was uploaded, which takes less storage in R2. The download of an original then gives the file served, and `hollware export` names each image by what its bytes are. The admin sets it under Site → Images.

- [`0150c9f`](https://github.com/hollware/hollware/commit/0150c9f4d1be3be699d6987946acd3bc5041e619) Thanks [@sergioazoc](https://github.com/sergioazoc)! - An entry can change its slug: `move_entry` (MCP) and "Change URL" in the admin give it another path and keep its revisions and translations. An entry that was ever published keeps its old slug as a redirect, which `list_redirects`, the RPC method `listRedirects`, `GET /v1/redirects`, `createHollware().redirectFor()` and the admin's Site page answer, so a site serves the old path with a 301; `hollware export --published` writes them to `redirects.json`. Moving a published entry takes content:publish and purges its pages.

- [`cebe6bb`](https://github.com/hollware/hollware/commit/cebe6bb99e776214d595f6223744b3fa670dd8ea) Thanks [@sergioazoc](https://github.com/sergioazoc)! - Entries can refer to entries of another collection: the rule `reference` of the catalog (a field, a collection, and optionally a locale) checks that each slug a field names exists when writing, and is published to publish. `get_entry` with `references: true` (MCP, RPC, `?references=true`, and `createHollware().getEntry(…, { references: true })`) answers the published entries each field names, in its order: an author, a series, the event of a talk.

- [`5e4bee1`](https://github.com/hollware/hollware/commit/5e4bee1adf9d2e119b90ca4ae3c5e07d8055c260) Thanks [@sergioazoc](https://github.com/sergioazoc)! - Responsive images: when an image is uploaded, Hollware also makes its narrower copies, the `media.widths` of the site (640 and 1280 pixels by default, `[]` for none), served at `<url>/<width>`. `upload_asset`, `get_asset` and `list_assets` answer `widths` and `srcset`; the HTML of `get_entry`, and the document a site reads, give each image its `srcset`, `sizes`, `width` and `height`; and a summary read by a site (`get_entry`, `list_entries`, `createHollware()`) carries `images`, the size and `srcset` of each image its frontmatter names, by URL, to lay out a cover. The admin sets the format, quality, widest width and copies in Site, and shows the copies of each image. Images uploaded before keep none.

- [`1ab4a4c`](https://github.com/hollware/hollware/commit/1ab4a4c26b492dedc77b1e1289ab883b4a0124d3) Thanks [@sergioazoc](https://github.com/sergioazoc)! - The history of an entry, over MCP and in the admin. `list_revisions` lists every revision of an entry, newest first, with who wrote it, when, what the contracts said, and which one the site shows; `get_revision` reads the Markdown of one; `restore_revision` goes back to one, as a new revision, so nothing is ever deleted or rewritten. The admin has a History tab on each entry: a revision opens beside the latest one, and "Restore this version" goes back to it.

- [`4c03dd3`](https://github.com/hollware/hollware/commit/4c03dd3f8fb3a366f095b3f8b84c4704819b714f) Thanks [@sergioazoc](https://github.com/sergioazoc)! - An entry can leave the site at a time: `schedule_unpublish` (MCP) and "Unpublish later" in the admin keep a published entry live until then, and the cron unpublishes it in the name of who scheduled it, if they may still publish. `get_entry` says when, as `unpublishAt`; null cancels it, and an unpublish before the time drops it.

- [`102ea18`](https://github.com/hollware/hollware/commit/102ea18cbc076fbc47f1128b0f71e98e4dd071d8) Thanks [@sergioazoc](https://github.com/sergioazoc)! - `search` answers, with `passages: true`, the passage each result matched: the whole section of the entry, its heading, and the URL of the entry on the site, what a model reads to answer with your content and cite it (RAG). `minScore` leaves out what matches by meaning less, so a question nothing answers finds nothing. Over MCP, RPC, the read API (`?passages=true&minScore=0.5`) and `createHollware`.

- [`bce8006`](https://github.com/hollware/hollware/commit/bce80069a466f41ee929f33bd11c302b92e9e3a2) Thanks [@sergioazoc](https://github.com/sergioazoc)! - A translation says when its source moved past it: `translationOutdated` is true for an entry in another locale than the site's default whose source, the entry of its group in the default locale, was changed after it was saved, until it is saved again. In list_entries, get_entry and get_translations; the admin marks it "behind its source" and filters by it.

### Patch Changes

- [`8d6edca`](https://github.com/hollware/hollware/commit/8d6edcadbf06f1c4b85c5fe9739fb09a2a1c1f85) Thanks [@sergioazoc](https://github.com/sergioazoc)! - The same image uploaded to two sites of one deployment is two assets, each with an id of its site and its bytes; with rc.2 the second upload failed with a server error and left its files in R2. Assets uploaded before keep their ids and are found by their bytes. `hollware import` of an export into another site writes the `asset:` references with the ids that site gives.

- [`1530a5f`](https://github.com/hollware/hollware/commit/1530a5f2a49cc6e47682e123e35a8d45cef4553b) Thanks [@sergioazoc](https://github.com/sergioazoc)! - The Markdown pipeline (version 2) checks the props of components that a site binds to links or images by their name (`to`, `url`, `link`, and names ending in `href`, `url` or `src`) as URLs: `::cta{to="javascript:…"}` loses the prop and the verdict says why.

- [`1310c51`](https://github.com/hollware/hollware/commit/1310c515a6ee07656aac57f3d5cd0fa0e824dd83) Thanks [@sergioazoc](https://github.com/sergioazoc)! - The READMEs on npm say what each package is and how it is used, instead of "pre-alpha, not usable yet"; the CLI's lists `dev` and `mcp-config`.

- [`d0f43a4`](https://github.com/hollware/hollware/commit/d0f43a433a29618c763a8fde6662f777b4bb00e2) Thanks [@sergioazoc](https://github.com/sergioazoc)! - A collection may not be named `admin`, `assets`, `ops`, `search` or `site`: those are routes of the read API under `/v1/`, which a collection of that name could never be read past.

- [`ca4225d`](https://github.com/hollware/hollware/commit/ca4225d3d0a04eb59323c89156ed167ec1b4b905) Thanks [@sergioazoc](https://github.com/sergioazoc)! - An SVG is refused when it holds a character reference or an entity beyond the five of XML, a backslash, or an animation of a link: `&[#106](https://github.com/hollware/hollware/issues/106);avascript:` in a `<set>`, or `@\69mport` in a style, got past the checks that read the text as written.

- [`865c6c7`](https://github.com/hollware/hollware/commit/865c6c75ebd68f3c30993a0f9f346c9188f7843f) Thanks [@sergioazoc](https://github.com/sergioazoc)! - `verifyWebhook` answers false for an empty secret instead of throwing, and the exchange of a preview link always redirects to a path of the site: a link whose path starts with `//` or `/\` no longer sends the browser to another host.

## 1.0.0-rc.2

### Minor Changes

- [`f16f745`](https://github.com/hollware/hollware/commit/f16f7452e24037ab564f4442839c26b463019d58) Thanks [@sergioazoc](https://github.com/sergioazoc)! - Images (ADR-038). `upload_asset` takes a JPEG, PNG, WebP, AVIF, GIF or SVG, judged by its bytes, and converts it once by the site's new `media` setting (WebP at 85 by default, PNG lossless, GIF with its frames, nothing wider than 2400 px; or AVIF, or the file as it came). An SVG is kept as it is, and refused when anything in it can run. R2 keeps the image and its original; content shows it as `img: asset:ast_…` or `![alt](asset:ast_…)`, which reads of the published site and HTML turn into the URL where the Worker serves it, cached for a year. `list_assets` and `get_asset` read them; the admin has an Images page; `hollware export --assets <dir> --assets-url <path>` writes the images for a site that serves them itself, and without it keeps the originals in `_assets/`, which `hollware import` uploads again under the same ids. A new project binds an R2 bucket (`MEDIA`), which the first deploy creates, and the Images binding (`IMAGES`); `hollware doctor` says when either is missing. Migration 0017 adds the `assets` table.

- [`51fc47c`](https://github.com/hollware/hollware/commit/51fc47c170d39ce69350c800d287309ba3ebb92e) Thanks [@sergioazoc](https://github.com/sergioazoc)! - `@hollware/client/webhooks` (and `@hollware/core/webhooks`): `verifyWebhook`, `signWebhook` and the header names, with no zod and no other import. A site whose own zod is another major, such as a Nuxt Content site on zod 3, checks Hollware's webhooks through it: the root entry evaluates every schema of Hollware with the site's zod, and fails at load.

## 1.0.0-rc.1

### Minor Changes

- [`84d96fd`](https://github.com/hollware/hollware/commit/84d96fdbfe0527c5aae28b52d2d5045c8ec69354) Thanks [@sergioazoc](https://github.com/sergioazoc)! - Setting Hollware up from an agent: `hollware init` and `hollware token create` take `--token-file <path>` (mode 0600, refused when the file exists unless `--force`) and print its path instead of the token, and `create-hollware` passes it through. `--json` on `create-hollware`, `init`, `token create`, `invite` and `doctor` prints one JSON object and nothing else. `hollware dev` starts the project's local server, waits for `/health` and stays in the foreground until SIGINT or SIGTERM (`--detach` and `--stop` run it in the background), and `hollware mcp-config` prints the `claude mcp add` line or the JSON block of Claude Code, Cursor and VS Code, which name `HOLLWARE_TOKEN` and never the token. The output of `init` and `create-hollware` says the passkey link is for the admin and an agent starts with the token alone. `GET /v1` answers 200 with the URLs of the OpenAPI document and of `/v1/site`, with no token. `update_site` and `set_collection` answer `conflict` on a stale version with a `message` and a `fix` that say to call `get_structure` again.

## 1.0.0-rc.0

### Major Changes

- [`b47f74a`](https://github.com/hollware/hollware/commit/b47f74aefaf518df6cc95b8cf9f33388b488cd22) Thanks [@sergioazoc](https://github.com/sergioazoc)! - Hollware 1.0: from this release on, a minor or patch version keeps working everything an agent, a site, a script or a project built against an earlier 1.x (ADR-036): the MCP tools with their scopes and schemas, the read API at `/v1`, the RPC entrypoint `Hollware`, the events of webhooks, the CLI's commands and flags, every package's exports, and the migrations already shipped. Every package of Hollware takes this version. See "Versions and stability" in the docs.

## 0.11.0

### Minor Changes

- [`069c95f`](https://github.com/hollware/hollware/commit/069c95f1e940ea4f9ac013cac3a69d5ad5d7732d) Thanks [@sergioazoc](https://github.com/sergioazoc)! - An activity log of who did what (ADR-037). Every operation that is not a read, every change of tokens, people and invitations in the admin, sign-in and sign-out, an invitation accepted, an app allowed or revoked, and each scheduled publication write a line: who did it as Hollware verified it (a person, a token, an app, or the deployment), what the client declared apart, the action, its target and its outcome, refusals of a scope included. The log is append-only in D1 (migration `0016_audit_log`). Owners read it on the admin's Activity page and download it as CSV.

  The owner decides what it keeps, in the site's `audit`: `ipAddresses` is `off` by default (`hashed` keeps an HMAC of each address keyed by the site, never the address), and `retentionDays` is `null` by default (forever), or 30 to 3650 days. `hollware init` and `npm create hollware` take `--ip-addresses` and `--audit-retention-days`.

- [`304e18d`](https://github.com/hollware/hollware/commit/304e18d68482c88db6987e2453bcfa0b75467595) Thanks [@sergioazoc](https://github.com/sergioazoc)! - A person in the admin opens the latest revision of an entry, a draft included, on the real site before it is published. "Preview on the site" makes a signed link of one hour for that entry (`hw_prv_…`, `POST /v1/admin/preview`, `preview.create` in the activity log), and `getEntry` takes it as `preview` over the RPC binding, the read API (`?preview=`) and `@hollware/client`; a token that does not hold is an error, never the published version. The token is in the URL once: `@hollware/nuxt` and the new `hollwarePreview()` middleware of `@hollware/astro` answer the link with a `303` to the same URL without `?hollware-preview=` and keep the token in the `hollware_preview` cookie (HttpOnly, SameSite=Lax, one hour, Secure but on localhost), `useHollwareEntry` and the live loader (`getLiveEntry('blog', { id, preview })`) read it from there, a token Hollware refuses as expired or invalid clears the cookie, and a previewed page is never cached. `@hollware/client` exports the pure parts. It needs the Worker secret `HOLLWARE_SECRET`.

- [`5e24d98`](https://github.com/hollware/hollware/commit/5e24d987c38466a315bcb3b94c3dfa23de90e71f) Thanks [@sergioazoc](https://github.com/sergioazoc)! - Security fixes from the threat model:

  - `verifyWebhook` takes `isNew(eventId)`. Given it, a webhook replayed within the tolerance is refused, by the id of its signed body (T-67).
  - The renderer reads a URL bound to the frontmatter (`:href="frontmatter.url"`) under its own rules instead of leaving it to `@comark/html`, which let a `data:image/svg+xml` link through (T-59).
  - An invitation link carries its secret in the fragment (`/setup#invitation=…`), which no request log holds. Older links still work (T-55).
  - Sign-in requires user verification explicitly. A counter that went back, or an assertion from another origin, is a refused passkey, not a server error (T-52, T-53).
  - The admin shows the preview of a draft in a sandboxed frame. Nothing it renders can run, reach the admin or draw over it (T-60).

### Patch Changes

- [`ead05f6`](https://github.com/hollware/hollware/commit/ead05f60b7240ede34e78a9f2694a238ac8932a6) Thanks [@sergioazoc](https://github.com/sergioazoc)! - A refresh token used again after it was spent revokes its grant (T-34). The OAuth library takes the previous refresh token again so a client whose answer was lost can retry; past one minute after the rotation that spent it, Hollware now refuses it, revokes the grant with every token of it, and writes `app.refresh_reused` to the site's activity log.

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
