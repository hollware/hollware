# @hollware/admin

## 1.0.0-rc.9

### Minor Changes

- [#26](https://github.com/hollware/hollware/pull/26) [`4fd2a54`](https://github.com/hollware/hollware/commit/4fd2a54a0426ee128403febc89d45e127c7fa5ac) Thanks [@sergioazoc](https://github.com/sergioazoc)! - One style of Markdown for people and agents. `create_draft` and `update_draft` store the canonical Markdown of Comark (`formatMarkdown` in `@hollware/core`) whenever it means the same document, and answer it as `markdown`; the same file in another style answers `unchanged`. Older revisions keep their bytes; an entry takes the canonical form at its next write.

  The admin is laid out like Linear. An entry is a page with its title and its body in a visual editor (TipTap through Nuxt UI): `/` inserts blocks and the components of the collection, a selection gets a bar of formats, blocks drag and move, Comark components are cards with their props, and anything the editor does not know stays a Markdown block. It saves by itself, writes with the same Comark writer the server uses, and opens a file it cannot keep byte for byte in the Markdown view (⌘⇧M). Properties, checks and a live preview, rendered with the pipeline of `@hollware/core`, sit in a side panel; history sits under the body; Publish is the one action of the bar and the rest is in the `⋯` menu. Entries are a list grouped by status with views, filters, keyboard moves (J, K, X) and a floating bar for many at once. Settings (site, collections, people, tokens, activity, account) have their own section at `/settings`; the old paths are gone. `?` lists the shortcuts.

  A violation may carry `code`, which kind of problem of its contract it is, and `params`, the values its message names, so a client can say it in another language; the admin shows the checks in Spanish from them, and the English `message` and `fix` stay as they were. The entry's side panel holds Properties and History; the live preview is gone, since the editor shows the page as it reads.

### Patch Changes

- [#24](https://github.com/hollware/hollware/pull/24) [`73110f5`](https://github.com/hollware/hollware/commit/73110f5317dd9da454ad45a84baccedd1403767a) Thanks [@sergioazoc](https://github.com/sergioazoc)! - An upload that opens on an XML declaration and many comments no longer stalls the check of its format, and a URL or a path with thousands of trailing slashes no longer takes seconds to trim: both are read in linear time.

- [#24](https://github.com/hollware/hollware/pull/24) [`73110f5`](https://github.com/hollware/hollware/commit/73110f5317dd9da454ad45a84baccedd1403767a) Thanks [@sergioazoc](https://github.com/sergioazoc)! - The packages carry no comments but the TSDoc of their public API, and the help of the CLI and the descriptions of the MCP tools no longer cite decision records the repository does not have. The starter's `AGENTS.md` now says what each setting of its `wrangler.jsonc` is for.

## 1.0.0-rc.8

No changes in this release.

## 1.0.0-rc.7

### Minor Changes

- [`0647944`](https://github.com/hollware/hollware/commit/06479447b92e584277b0be96162888039e198adb) Thanks [@sergioazoc](https://github.com/sergioazoc)! - Hollware no longer counts page views: a site connects the analytics it already has, and `content_stats` reads them (ADR-040). Connect Cloudflare Web Analytics, PostHog, Plausible or GA4 in the admin (Site, Analytics), with `hollware analytics connect <provider> --credential-file <file>`, or with the new tool `connect_analytics`; the read-only key is tested before it is kept, sealed under `HOLLWARE_SECRET`, and never shown again (`get_analytics`, `disconnect_analytics`).

  To upgrade: remove `beacon` from `hollware` in `nuxt.config`; remove the `analytics_engine_datasets` binding `ANALYTICS` and the variables `HOLLWARE_ANALYTICS_ACCOUNT_ID` and `HOLLWARE_ANALYTICS_DATASET` from the Worker's `wrangler.jsonc`, and delete its secret `HOLLWARE_ANALYTICS_TOKEN` (`wrangler secret delete HOLLWARE_ANALYTICS_TOKEN`); then connect the site's analytics. `POST /events` is gone, and `@hollware/server` no longer exports `AnalyticsWriter` and `PageView`.

## 1.0.0-rc.6

### Minor Changes

- [`b8b1f62`](https://github.com/hollware/hollware/commit/b8b1f62576bfa753d8f54af8bf871281b4a23ece) Thanks [@sergioazoc](https://github.com/sergioazoc)! - The admin and the sign-in pages take Hollware's own look (ADR-039): the flame pumpkin as the mark, Schibsted Grotesk and JetBrains Mono, a warm black ground and an amber accent. Publishing an entry is the amber button of its page.

## 1.0.0-rc.5

### Patch Changes

- [`35bafa0`](https://github.com/hollware/hollware/commit/35bafa07af847f1810905eaa5963a71f98b2c7cd) Thanks [@sergioazoc](https://github.com/sergioazoc)! - The unchanged lines a diff folds (in Reviews and in the history of an entry) are a flat band in the colors of the admin, with the number of lines and a way to show them, in English or Spanish, instead of the merge view's light gradient.

## 1.0.0-rc.4

No changes in this release.

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

- [`5e4bee1`](https://github.com/hollware/hollware/commit/5e4bee1adf9d2e119b90ca4ae3c5e07d8055c260) Thanks [@sergioazoc](https://github.com/sergioazoc)! - Responsive images: when an image is uploaded, Hollware also makes its narrower copies, the `media.widths` of the site (640 and 1280 pixels by default, `[]` for none), served at `<url>/<width>`. `upload_asset`, `get_asset` and `list_assets` answer `widths` and `srcset`; the HTML of `get_entry`, and the document a site reads, give each image its `srcset`, `sizes`, `width` and `height`; and a summary read by a site (`get_entry`, `list_entries`, `createHollware()`) carries `images`, the size and `srcset` of each image its frontmatter names, by URL, to lay out a cover. The admin sets the format, quality, widest width and copies in Site, and shows the copies of each image. Images uploaded before keep none.

- [`1ab4a4c`](https://github.com/hollware/hollware/commit/1ab4a4c26b492dedc77b1e1289ab883b4a0124d3) Thanks [@sergioazoc](https://github.com/sergioazoc)! - The history of an entry, over MCP and in the admin. `list_revisions` lists every revision of an entry, newest first, with who wrote it, when, what the contracts said, and which one the site shows; `get_revision` reads the Markdown of one; `restore_revision` goes back to one, as a new revision, so nothing is ever deleted or rewritten. The admin has a History tab on each entry: a revision opens beside the latest one, and "Restore this version" goes back to it.

- [`4c03dd3`](https://github.com/hollware/hollware/commit/4c03dd3f8fb3a366f095b3f8b84c4704819b714f) Thanks [@sergioazoc](https://github.com/sergioazoc)! - An entry can leave the site at a time: `schedule_unpublish` (MCP) and "Unpublish later" in the admin keep a published entry live until then, and the cron unpublishes it in the name of who scheduled it, if they may still publish. `get_entry` says when, as `unpublishAt`; null cancels it, and an unpublish before the time drops it.

- [`bce8006`](https://github.com/hollware/hollware/commit/bce80069a466f41ee929f33bd11c302b92e9e3a2) Thanks [@sergioazoc](https://github.com/sergioazoc)! - A translation says when its source moved past it: `translationOutdated` is true for an entry in another locale than the site's default whose source, the entry of its group in the default locale, was changed after it was saved, until it is saved again. In list_entries, get_entry and get_translations; the admin marks it "behind its source" and filters by it.

### Patch Changes

- [`1310c51`](https://github.com/hollware/hollware/commit/1310c515a6ee07656aac57f3d5cd0fa0e824dd83) Thanks [@sergioazoc](https://github.com/sergioazoc)! - The READMEs on npm say what each package is and how it is used, instead of "pre-alpha, not usable yet"; the CLI's lists `dev` and `mcp-config`.

- [`8c9de8f`](https://github.com/hollware/hollware/commit/8c9de8f4eb46eedcad1f4bf0635ae80acd678edf) Thanks [@sergioazoc](https://github.com/sergioazoc)! - The count under every table of the admin names the rows of its page, "1–25 of 120", and what a filter left, "1–3 of 3, filtered from 120"; it kept the number it read before the rows arrived.

## 1.0.0-rc.2

### Minor Changes

- [`f16f745`](https://github.com/hollware/hollware/commit/f16f7452e24037ab564f4442839c26b463019d58) Thanks [@sergioazoc](https://github.com/sergioazoc)! - Images (ADR-038). `upload_asset` takes a JPEG, PNG, WebP, AVIF, GIF or SVG, judged by its bytes, and converts it once by the site's new `media` setting (WebP at 85 by default, PNG lossless, GIF with its frames, nothing wider than 2400 px; or AVIF, or the file as it came). An SVG is kept as it is, and refused when anything in it can run. R2 keeps the image and its original; content shows it as `img: asset:ast_…` or `![alt](asset:ast_…)`, which reads of the published site and HTML turn into the URL where the Worker serves it, cached for a year. `list_assets` and `get_asset` read them; the admin has an Images page; `hollware export --assets <dir> --assets-url <path>` writes the images for a site that serves them itself, and without it keeps the originals in `_assets/`, which `hollware import` uploads again under the same ids. A new project binds an R2 bucket (`MEDIA`), which the first deploy creates, and the Images binding (`IMAGES`); `hollware doctor` says when either is missing. Migration 0017 adds the `assets` table.

## 1.0.0-rc.1

No changes in this release.

## 1.0.0-rc.0

No changes in this release.

## 0.11.0

### Minor Changes

- [`9e72522`](https://github.com/hollware/hollware/commit/9e725225be6bf8e85518f2521b21e76b9109681b) Thanks [@sergioazoc](https://github.com/sergioazoc)! - The admin has an Account page, from the person menu, where a person removes a passkey, revokes an app they connected or signs out everywhere, and the person menu signs this browser out.

- [`069c95f`](https://github.com/hollware/hollware/commit/069c95f1e940ea4f9ac013cac3a69d5ad5d7732d) Thanks [@sergioazoc](https://github.com/sergioazoc)! - An activity log of who did what (ADR-037). Every operation that is not a read, every change of tokens, people and invitations in the admin, sign-in and sign-out, an invitation accepted, an app allowed or revoked, and each scheduled publication write a line: who did it as Hollware verified it (a person, a token, an app, or the deployment), what the client declared apart, the action, its target and its outcome, refusals of a scope included. The log is append-only in D1 (migration `0016_audit_log`). Owners read it on the admin's Activity page and download it as CSV.

  The owner decides what it keeps, in the site's `audit`: `ipAddresses` is `off` by default (`hashed` keeps an HMAC of each address keyed by the site, never the address), and `retentionDays` is `null` by default (forever), or 30 to 3650 days. `hollware init` and `npm create hollware` take `--ip-addresses` and `--audit-retention-days`.

- [`304e18d`](https://github.com/hollware/hollware/commit/304e18d68482c88db6987e2453bcfa0b75467595) Thanks [@sergioazoc](https://github.com/sergioazoc)! - A person in the admin opens the latest revision of an entry, a draft included, on the real site before it is published. "Preview on the site" makes a signed link of one hour for that entry (`hw_prv_…`, `POST /v1/admin/preview`, `preview.create` in the activity log), and `getEntry` takes it as `preview` over the RPC binding, the read API (`?preview=`) and `@hollware/client`; a token that does not hold is an error, never the published version. The token is in the URL once: `@hollware/nuxt` and the new `hollwarePreview()` middleware of `@hollware/astro` answer the link with a `303` to the same URL without `?hollware-preview=` and keep the token in the `hollware_preview` cookie (HttpOnly, SameSite=Lax, one hour, Secure but on localhost), `useHollwareEntry` and the live loader (`getLiveEntry('blog', { id, preview })`) read it from there, a token Hollware refuses as expired or invalid clears the cookie, and a previewed page is never cached. `@hollware/client` exports the pure parts. It needs the Worker secret `HOLLWARE_SECRET`.

- [`3893d8e`](https://github.com/hollware/hollware/commit/3893d8e6b2d66ceb429cc24dbad51a5a2191dd89) Thanks [@sergioazoc](https://github.com/sergioazoc)! - A token's expiry is the person's choice: `hollware token create` and the admin's Tokens page make a token that never expires when no days are given, and one that expires in the days given (1 to 365) otherwise. Revoking it ends it at once.

### Patch Changes

- [`39dd8fa`](https://github.com/hollware/hollware/commit/39dd8fa82280d9d3fe1f57c0606a1954cb583e8e) Thanks [@sergioazoc](https://github.com/sergioazoc)! - The button of the person at the foot of the sidebar has a name while the admin still loads who is signed in.

- [`6580025`](https://github.com/hollware/hollware/commit/6580025fd537a3756a4f93e04dae69e79bca4b8c) Thanks [@sergioazoc](https://github.com/sergioazoc)! - Security headers that the OWASP ZAP baseline of staging asked for: every answer of the Worker has `X-Content-Type-Options: nosniff`, and `Strict-Transport-Security` when the public URL is https. Its pages add `Cross-Origin-Opener-Policy` and `Cross-Origin-Resource-Policy` of `same-origin` and a `Permissions-Policy` that asks for no device. The sign-in, setup and consent pages allow their own stylesheet by its hash instead of `'unsafe-inline'`, and the admin's built files get the same headers through `_headers`.

- [`5e24d98`](https://github.com/hollware/hollware/commit/5e24d987c38466a315bcb3b94c3dfa23de90e71f) Thanks [@sergioazoc](https://github.com/sergioazoc)! - Security fixes from the threat model:

  - `verifyWebhook` takes `isNew(eventId)`. Given it, a webhook replayed within the tolerance is refused, by the id of its signed body (T-67).
  - The renderer reads a URL bound to the frontmatter (`:href="frontmatter.url"`) under its own rules instead of leaving it to `@comark/html`, which let a `data:image/svg+xml` link through (T-59).
  - An invitation link carries its secret in the fragment (`/setup#invitation=…`), which no request log holds. Older links still work (T-55).
  - Sign-in requires user verification explicitly. A counter that went back, or an assertion from another origin, is a refused passkey, not a server error (T-52, T-53).
  - The admin shows the preview of a draft in a sandboxed frame. Nothing it renders can run, reach the admin or draw over it (T-60).

## 0.10.0

### Minor Changes

- [`eb4df6d`](https://github.com/hollware/hollware/commit/eb4df6dd3a8eafc7b04266478a2f0950adea0bbc) Thanks [@sergioazoc](https://github.com/sergioazoc)! - Entries have a trash: `delete_entry` moves a draft there and cancels its pending review, `restore_entry` brings it back as the draft it was, `list_entries` lists it with `trashed: true`, every summary carries `deletedAt`, `create_draft` answers `in_trash` for the slug a trashed entry keeps, migration `0014_entry_trash` adds the column, and the admin trashes a draft from the editor and lists, trashes and restores entries in bulk under the filter "In the trash".

### Patch Changes

- [`eb4df6d`](https://github.com/hollware/hollware/commit/eb4df6dd3a8eafc7b04266478a2f0950adea0bbc) Thanks [@sergioazoc](https://github.com/sergioazoc)! - The bar of every page names the site the page is of, with the menu to switch to another, so it is clear whose collections, entries and people a page shows.

- [`f21e6f8`](https://github.com/hollware/hollware/commit/f21e6f8e4245d0a2ead778d120e4d2e6c63213d2) Thanks [@sergioazoc](https://github.com/sergioazoc)! - The admin loads less than half the JavaScript it did on its first page (Nuxt UI 4.12 loads the code of a component only on the pages that use it, and its menus, palette and toasts when they open), and its site and person buttons, and the links to translations, are named by what they show. New projects get wrangler 4.151.0 and zod 4.6.7.

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
