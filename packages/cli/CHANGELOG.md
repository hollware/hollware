# hollware

## 1.0.0-rc.3

### Minor Changes

- [`f31b9fb`](https://github.com/hollware/hollware/commit/f31b9fbbd99f08ab8d094742813f62dc32834d44) Thanks [@sergioazoc](https://github.com/sergioazoc)! - Fields Hollware fills itself: a collection's `automaticFields` names them and how, `firstPublished` (the date an entry first went out; a date written wins), `lastModified` (the date of a change published after that), `readingTime` (minutes at 200 words a minute) and `wordCount`. Nobody writes them: they are never required, `describe_site` marks them `readOnly`, and the admin's entry form leaves them out. A site reads them filled (RPC, the read API, `createHollware()`), `get_entry` answers their values as `automatic`, and `hollware export --published` writes them into the frontmatter; the Markdown stored stays what was written. The admin chooses them per field on the page of a collection, and a new blog fills its `date`.

- [`0235865`](https://github.com/hollware/hollware/commit/0235865719899057dc58f7888208c16f1e990eda) Thanks [@sergioazoc](https://github.com/sergioazoc)! - Daily backups of each site to R2: after 03:00 UTC the cron writes `backups/<site>/<date>.json` to the bucket `MEDIA`, with the definition of the site and every entry, its latest Markdown and the published one, and keeps 30 days. `list_backups` (MCP and the admin's Site page) lists them, `GET /v1/backups/<date>` downloads one with `schema:admin`, and `hollware backup list` and `hollware backup get <date> <dir> [--published]` turn one back into the files `hollware import` reads.

- [`29e7ecc`](https://github.com/hollware/hollware/commit/29e7ecc893fcb5f145e53b99a7f158b518e423f3) Thanks [@sergioazoc](https://github.com/sergioazoc)! - `media.keepOriginals` (true by default): a site that sets it to `false` keeps only the file it serves and its copies, not the file as it was uploaded, which takes less storage in R2. The download of an original then gives the file served, and `hollware export` names each image by what its bytes are. The admin sets it under Site → Images.

- [`0150c9f`](https://github.com/hollware/hollware/commit/0150c9f4d1be3be699d6987946acd3bc5041e619) Thanks [@sergioazoc](https://github.com/sergioazoc)! - An entry can change its slug: `move_entry` (MCP) and "Change URL" in the admin give it another path and keep its revisions and translations. An entry that was ever published keeps its old slug as a redirect, which `list_redirects`, the RPC method `listRedirects`, `GET /v1/redirects`, `createHollware().redirectFor()` and the admin's Site page answer, so a site serves the old path with a 301; `hollware export --published` writes them to `redirects.json`. Moving a published entry takes content:publish and purges its pages.

### Patch Changes

- [`8d6edca`](https://github.com/hollware/hollware/commit/8d6edcadbf06f1c4b85c5fe9739fb09a2a1c1f85) Thanks [@sergioazoc](https://github.com/sergioazoc)! - The same image uploaded to two sites of one deployment is two assets, each with an id of its site and its bytes; with rc.2 the second upload failed with a server error and left its files in R2. Assets uploaded before keep their ids and are found by their bytes. `hollware import` of an export into another site writes the `asset:` references with the ids that site gives.

- [`20f1fe3`](https://github.com/hollware/hollware/commit/20f1fe3d065d6b8484f1264ea23c41dcf061005b) Thanks [@sergioazoc](https://github.com/sergioazoc)! - `hollware deploy` of a project deployed before applies the new migrations to the remote database first, while its Worker still serves, and then deploys the new Worker, which so never serves a database without its tables. The starter's README and AGENTS.md say how to upgrade: one version for every package, a project of the new release to compare with, then deploy.

- [`9e07b1e`](https://github.com/hollware/hollware/commit/9e07b1e893afc0c808ad2cfaff8c5edae91dca3f) Thanks [@sergioazoc](https://github.com/sergioazoc)! - `hollware doctor` also checks the cron trigger, the events queue (its producer and its consumer) and the rate limit `HOLLWARE_RATE_LIMIT`, which a project needs for scheduled publications, webhooks and IndexNow, and limits on sign-in.

- [`1310c51`](https://github.com/hollware/hollware/commit/1310c515a6ee07656aac57f3d5cd0fa0e824dd83) Thanks [@sergioazoc](https://github.com/sergioazoc)! - The READMEs on npm say what each package is and how it is used, instead of "pre-alpha, not usable yet"; the CLI's lists `dev` and `mcp-config`.
- Updated dependencies [[`8d6edca`](https://github.com/hollware/hollware/commit/8d6edcadbf06f1c4b85c5fe9739fb09a2a1c1f85), [`f31b9fb`](https://github.com/hollware/hollware/commit/f31b9fbbd99f08ab8d094742813f62dc32834d44), [`83f582a`](https://github.com/hollware/hollware/commit/83f582ab6e2483fe94ba7d3953b3b968835443c7), [`1530a5f`](https://github.com/hollware/hollware/commit/1530a5f2a49cc6e47682e123e35a8d45cef4553b), [`0235865`](https://github.com/hollware/hollware/commit/0235865719899057dc58f7888208c16f1e990eda), [`0075a00`](https://github.com/hollware/hollware/commit/0075a0089e21f378c2295b4f26f5626e866bad67), [`29e7ecc`](https://github.com/hollware/hollware/commit/29e7ecc893fcb5f145e53b99a7f158b518e423f3), [`0150c9f`](https://github.com/hollware/hollware/commit/0150c9f4d1be3be699d6987946acd3bc5041e619), [`1310c51`](https://github.com/hollware/hollware/commit/1310c515a6ee07656aac57f3d5cd0fa0e824dd83), [`cebe6bb`](https://github.com/hollware/hollware/commit/cebe6bb99e776214d595f6223744b3fa670dd8ea), [`d0f43a4`](https://github.com/hollware/hollware/commit/d0f43a433a29618c763a8fde6662f777b4bb00e2), [`5e4bee1`](https://github.com/hollware/hollware/commit/5e4bee1adf9d2e119b90ca4ae3c5e07d8055c260), [`1ab4a4c`](https://github.com/hollware/hollware/commit/1ab4a4c26b492dedc77b1e1289ab883b4a0124d3), [`4c03dd3`](https://github.com/hollware/hollware/commit/4c03dd3f8fb3a366f095b3f8b84c4704819b714f), [`102ea18`](https://github.com/hollware/hollware/commit/102ea18cbc076fbc47f1128b0f71e98e4dd071d8), [`ca4225d`](https://github.com/hollware/hollware/commit/ca4225d3d0a04eb59323c89156ed167ec1b4b905), [`bce8006`](https://github.com/hollware/hollware/commit/bce80069a466f41ee929f33bd11c302b92e9e3a2), [`865c6c7`](https://github.com/hollware/hollware/commit/865c6c75ebd68f3c30993a0f9f346c9188f7843f)]:
  - @hollware/core@1.0.0-rc.3

## 1.0.0-rc.2

### Minor Changes

- [`055d933`](https://github.com/hollware/hollware/commit/055d9332daf8cd27117e0a0e5868ffb2c735b1c1) Thanks [@sergioazoc](https://github.com/sergioazoc)! - `hollware deploy --url https://cms.example.com` now serves the Worker there: a public URL on a domain of your own (not workers.dev) gets a `custom_domain` route in `wrangler.jsonc` before the first deploy, so Cloudflare makes its DNS record and its certificate, and the Worker is deployed once. A config with routes of its own is left as it is, and deploy says which route is missing.

- [`f16f745`](https://github.com/hollware/hollware/commit/f16f7452e24037ab564f4442839c26b463019d58) Thanks [@sergioazoc](https://github.com/sergioazoc)! - Images (ADR-038). `upload_asset` takes a JPEG, PNG, WebP, AVIF, GIF or SVG, judged by its bytes, and converts it once by the site's new `media` setting (WebP at 85 by default, PNG lossless, GIF with its frames, nothing wider than 2400 px; or AVIF, or the file as it came). An SVG is kept as it is, and refused when anything in it can run. R2 keeps the image and its original; content shows it as `img: asset:ast_…` or `![alt](asset:ast_…)`, which reads of the published site and HTML turn into the URL where the Worker serves it, cached for a year. `list_assets` and `get_asset` read them; the admin has an Images page; `hollware export --assets <dir> --assets-url <path>` writes the images for a site that serves them itself, and without it keeps the originals in `_assets/`, which `hollware import` uploads again under the same ids. A new project binds an R2 bucket (`MEDIA`), which the first deploy creates, and the Images binding (`IMAGES`); `hollware doctor` says when either is missing. Migration 0017 adds the `assets` table.

### Patch Changes

- [`28f0198`](https://github.com/hollware/hollware/commit/28f0198a417044d1d67584dcccaa9977bb97f657) Thanks [@sergioazoc](https://github.com/sergioazoc)! - `hollware deploy` says why wrangler failed in full, over every line of a wrapped `[ERROR]`, and suggests `wrangler login` only when wrangler's failure is about logging in. Its closing line no longer says the deploy wrote ids into `wrangler.jsonc`: wrangler now binds what it creates to the deployed Worker by name.

- [`d6ef107`](https://github.com/hollware/hollware/commit/d6ef10750cbd045b20225eb289b3b76859cba61a) Thanks [@sergioazoc](https://github.com/sergioazoc)! - A project keeps working at localhost after `hollware deploy`: the starter's `vite.config.ts` sets `HOLLWARE_PUBLIC_URL` to `http://localhost:5199` in development (`vp dev`), whatever public URL the deploy wrote into `wrangler.jsonc`, and `hollware dev` waits for the server there. `hollware deploy` writes `worker-configuration.d.ts` again whenever it rewrites `wrangler.jsonc`, so `wrangler types --check` keeps passing.
- Updated dependencies [[`f16f745`](https://github.com/hollware/hollware/commit/f16f7452e24037ab564f4442839c26b463019d58), [`51fc47c`](https://github.com/hollware/hollware/commit/51fc47c170d39ce69350c800d287309ba3ebb92e)]:
  - @hollware/core@1.0.0-rc.2

## 1.0.0-rc.1

### Minor Changes

- [`84d96fd`](https://github.com/hollware/hollware/commit/84d96fdbfe0527c5aae28b52d2d5045c8ec69354) Thanks [@sergioazoc](https://github.com/sergioazoc)! - Setting Hollware up from an agent: `hollware init` and `hollware token create` take `--token-file <path>` (mode 0600, refused when the file exists unless `--force`) and print its path instead of the token, and `create-hollware` passes it through. `--json` on `create-hollware`, `init`, `token create`, `invite` and `doctor` prints one JSON object and nothing else. `hollware dev` starts the project's local server, waits for `/health` and stays in the foreground until SIGINT or SIGTERM (`--detach` and `--stop` run it in the background), and `hollware mcp-config` prints the `claude mcp add` line or the JSON block of Claude Code, Cursor and VS Code, which name `HOLLWARE_TOKEN` and never the token. The output of `init` and `create-hollware` says the passkey link is for the admin and an agent starts with the token alone. `GET /v1` answers 200 with the URLs of the OpenAPI document and of `/v1/site`, with no token. `update_site` and `set_collection` answer `conflict` on a stale version with a `message` and a `fix` that say to call `get_structure` again.

### Patch Changes

- [`84d96fd`](https://github.com/hollware/hollware/commit/84d96fdbfe0527c5aae28b52d2d5045c8ec69354) Thanks [@sergioazoc](https://github.com/sergioazoc)! - What a rehearsal of moving a real site into Hollware turned up. A database that lacks the migrations of its release answers a 503 `not_migrated` that names the command to run, instead of a bare 500. `hollware import` shows an unchanged entry with the verdict of this run, not the one kept since it was written, which a change of the site's definition can have made stale. `npm create hollware` prints how to connect an agent once (init's block, which names `HOLLWARE_TOKEN`, never the token), and starts the project with `hollware dev`.
- Updated dependencies [[`84d96fd`](https://github.com/hollware/hollware/commit/84d96fdbfe0527c5aae28b52d2d5045c8ec69354)]:
  - @hollware/core@1.0.0-rc.1

## 1.0.0-rc.0

### Patch Changes

- Updated dependencies [[`b47f74a`](https://github.com/hollware/hollware/commit/b47f74aefaf518df6cc95b8cf9f33388b488cd22)]:
  - @hollware/core@1.0.0-rc.0

## 0.11.0

### Minor Changes

- [`069c95f`](https://github.com/hollware/hollware/commit/069c95f1e940ea4f9ac013cac3a69d5ad5d7732d) Thanks [@sergioazoc](https://github.com/sergioazoc)! - An activity log of who did what (ADR-037). Every operation that is not a read, every change of tokens, people and invitations in the admin, sign-in and sign-out, an invitation accepted, an app allowed or revoked, and each scheduled publication write a line: who did it as Hollware verified it (a person, a token, an app, or the deployment), what the client declared apart, the action, its target and its outcome, refusals of a scope included. The log is append-only in D1 (migration `0016_audit_log`). Owners read it on the admin's Activity page and download it as CSV.

  The owner decides what it keeps, in the site's `audit`: `ipAddresses` is `off` by default (`hashed` keeps an HMAC of each address keyed by the site, never the address), and `retentionDays` is `null` by default (forever), or 30 to 3650 days. `hollware init` and `npm create hollware` take `--ip-addresses` and `--audit-retention-days`.

- [`3893d8e`](https://github.com/hollware/hollware/commit/3893d8e6b2d66ceb429cc24dbad51a5a2191dd89) Thanks [@sergioazoc](https://github.com/sergioazoc)! - A token's expiry is the person's choice: `hollware token create` and the admin's Tokens page make a token that never expires when no days are given, and one that expires in the days given (1 to 365) otherwise. Revoking it ends it at once.

### Patch Changes

- [`5e24d98`](https://github.com/hollware/hollware/commit/5e24d987c38466a315bcb3b94c3dfa23de90e71f) Thanks [@sergioazoc](https://github.com/sergioazoc)! - Security fixes from the threat model:

  - `verifyWebhook` takes `isNew(eventId)`. Given it, a webhook replayed within the tolerance is refused, by the id of its signed body (T-67).
  - The renderer reads a URL bound to the frontmatter (`:href="frontmatter.url"`) under its own rules instead of leaving it to `@comark/html`, which let a `data:image/svg+xml` link through (T-59).
  - An invitation link carries its secret in the fragment (`/setup#invitation=…`), which no request log holds. Older links still work (T-55).
  - Sign-in requires user verification explicitly. A counter that went back, or an assertion from another origin, is a refused passkey, not a server error (T-52, T-53).
  - The admin shows the preview of a draft in a sandboxed frame. Nothing it renders can run, reach the admin or draw over it (T-60).

- Updated dependencies [[`069c95f`](https://github.com/hollware/hollware/commit/069c95f1e940ea4f9ac013cac3a69d5ad5d7732d), [`304e18d`](https://github.com/hollware/hollware/commit/304e18d68482c88db6987e2453bcfa0b75467595), [`ead05f6`](https://github.com/hollware/hollware/commit/ead05f60b7240ede34e78a9f2694a238ac8932a6), [`5e24d98`](https://github.com/hollware/hollware/commit/5e24d987c38466a315bcb3b94c3dfa23de90e71f)]:
  - @hollware/core@0.11.0

## 0.10.0

### Minor Changes

- [`2d70e42`](https://github.com/hollware/hollware/commit/2d70e428142983d3859dbc68450dfa9510baabc2) Thanks [@sergioazoc](https://github.com/sergioazoc)! - `hollware export <directory>` writes the entries of a site over MCP as `<collection>/<locale>/<slug>.md`, byte for byte as Hollware keeps them, so that `hollware import` takes them back unchanged, with `--published`, `--collection`, `--locale`, `--site` and `--dry-run`.

- [`2d70e42`](https://github.com/hollware/hollware/commit/2d70e428142983d3859dbc68450dfa9510baabc2) Thanks [@sergioazoc](https://github.com/sergioazoc)! - `hollware import --from nuxt-content` moves a Nuxt Content site to Hollware: the pages of its `content/` routed as Nuxt Content routes them, their Markdown kept, a `title` from their first heading when they have none, and with `--locale-dirs` their locale from the first folder and their translations tied in a group.

### Patch Changes

- Updated dependencies [[`eb4df6d`](https://github.com/hollware/hollware/commit/eb4df6dd3a8eafc7b04266478a2f0950adea0bbc), [`6a8e7b5`](https://github.com/hollware/hollware/commit/6a8e7b57f894722d808f1708b353884ad2f0a6d7), [`ad56b86`](https://github.com/hollware/hollware/commit/ad56b8656041396926ab9b1de602cf15519a5f38), [`75341bf`](https://github.com/hollware/hollware/commit/75341bf1134084e2ac8b316a661ee46fe863b1ca)]:
  - @hollware/core@0.10.0

## 0.9.1

### Patch Changes

- Updated dependencies []:
  - @hollware/core@0.9.1

## 0.9.0

### Patch Changes

- Updated dependencies []:
  - @hollware/core@0.9.0

## 0.8.0

### Minor Changes

- [`eaa743d`](https://github.com/hollware/hollware/commit/eaa743d4f6a6cb7ec5977f73379e6f414f43403f) Thanks [@sergioazoc](https://github.com/sergioazoc)! - A new project has no `hollware.config.ts` (ADR-033): the starter's Worker is `createHollware()`, and `hollware init` gives the site its first definition from a preset, `--preset blog|docs|empty` (blog by default) in `--locales` (en by default), which `create-hollware` takes too and hands to it. A project that still has a config keeps it: `init` writes no definition there, and the Worker moves the config into the database on its first request. The presets live in `@hollware/core` (`sitePreset`, `collectionPreset`), shared by the CLI and the admin. The fixes Hollware gives point at the admin and the operations instead of a config file.

- [`286149b`](https://github.com/hollware/hollware/commit/286149b7106adb84b5ee02b0433dc780b50be6e3) Thanks [@sergioazoc](https://github.com/sergioazoc)! - Webhooks need no Worker secret of their own (ADR-033): one that names none is signed with a secret Hollware makes with the new operation `make_webhook_secret`, answers once, and keeps sealed in D1 (migration `0012_site_secrets`) under `HOLLWARE_SECRET`, which `hollware deploy` now makes when the Worker has none. The admin's Site adds and removes webhooks and makes their secrets. A site in the trash keeps its rows until it is restored.

### Patch Changes

- Updated dependencies [[`501174a`](https://github.com/hollware/hollware/commit/501174a4b9cd7e0a5191fa587c09e39f71ff3bd7), [`eaa743d`](https://github.com/hollware/hollware/commit/eaa743d4f6a6cb7ec5977f73379e6f414f43403f), [`f2f2c3d`](https://github.com/hollware/hollware/commit/f2f2c3d6ac6123d26bc1bc0d2b668b61d42afd9d), [`d1ea96e`](https://github.com/hollware/hollware/commit/d1ea96e61df8a7b58e0a9b5e76b85abdddc78a7a), [`3f3cb16`](https://github.com/hollware/hollware/commit/3f3cb16b9779defecc14c95b6607989a3dd22367), [`286149b`](https://github.com/hollware/hollware/commit/286149b7106adb84b5ee02b0433dc780b50be6e3)]:
  - @hollware/core@0.8.0

## 0.7.0

### Patch Changes

- Updated dependencies [[`e43c814`](https://github.com/hollware/hollware/commit/e43c81420272ed1a0835ec681df11ac4cc259539)]:
  - @hollware/core@0.7.0

## 0.6.0

### Patch Changes

- [`03df44d`](https://github.com/hollware/hollware/commit/03df44d3ff8a24a3b285645f137cd973ff9e1b9c) Thanks [@sergioazoc](https://github.com/sergioazoc)! - The agents fit the Workers free plan: Hollware's cron wakes them every ten minutes over an `AGENTS` service binding to their `run` entrypoint, so they need no cron trigger of their own (five per account), and each run is one agent in turn, within the fifty calls a free run may make (the translator reads each locale in one listing, the reviewer takes eight reviews a run, the auditor checks a dozen entries a run and writes its report from them once a week). Their requests carry the Host of Hollware's public URL, which a service binding does not set. `hollware migrate --remote` takes a Time Travel bookmark of a database D1 cannot export, as any database with the full-text index of 0.5 is, instead of stopping.
- Updated dependencies [[`30339e0`](https://github.com/hollware/hollware/commit/30339e000c290ddbceab88161be35ef071ccbe0e), [`059ecdf`](https://github.com/hollware/hollware/commit/059ecdffdd9d4394918dd594cf855898bf34b6d1)]:
  - @hollware/core@0.6.0

## 0.5.0

### Patch Changes

- Updated dependencies [[`02b2fe2`](https://github.com/hollware/hollware/commit/02b2fe2afc509bb3fb6a0f0110d1002b50953e26), [`0712311`](https://github.com/hollware/hollware/commit/071231163dbf2bb7f5e3368466c5ed0ea5a3c20c), [`310b3ab`](https://github.com/hollware/hollware/commit/310b3abbadfe303be1c90e4c5009ef99bc08c8e1), [`b84107c`](https://github.com/hollware/hollware/commit/b84107c9d0dd0d60d9521c7314a030cf4ab0cc67)]:
  - @hollware/core@0.5.0

## 0.4.0

### Minor Changes

- [`2b76bb0`](https://github.com/hollware/hollware/commit/2b76bb01979986c7f9ec8bb2b2080bad7c252fcd) Thanks [@sergioazoc](https://github.com/sergioazoc)! - `npm create hollware <dir>` makes a project: the starter, every Hollware package at its own version, `git init`, the install, the local migrations, and the site with its owner and a first token, then the `claude mcp add` line for it. `hollware deploy` deploys to Cloudflare, creating the D1 database, the KV namespace and the queues on the first run and setting the public URL of the Worker, and migrates the remote database. `hollware doctor` checks a project and says what to fix. `hollware migrate --remote` takes no backup of a database that has none of the migrations yet.

- [`43333d3`](https://github.com/hollware/hollware/commit/43333d309843e464c47b20412d2d1d05738c835a) Thanks [@sergioazoc](https://github.com/sergioazoc)! - A deployment serves every site of its config (ADR-027). A personal token, an OAuth grant and an RPC call each act on the one site they name; a person has one passkey and one session for the deployment, with a role per site. The consent page asks which site when the person is in several, the admin switches sites (`GET /v1/admin/me`), and `hollware init --site <key>` on a database with an owner adds the site to that owner. Migration `0006_people_across_sites.sql` drops `site_id` from passkeys, sessions and sign-in challenges.

- [`a7b5f26`](https://github.com/hollware/hollware/commit/a7b5f261d08bf8b58e3dc98ee0a7148de71d394b) Thanks [@sergioazoc](https://github.com/sergioazoc)! - Read tokens and CORS for the read API (ADR-028). A read token (`hw_read_`) reads the published content of one site over `GET /v1/…` and is refused everywhere else; make one with `hollware token create --read` or in the admin. A site lists the origins of its pages in `cors.origins`, and those pages may read it from the browser. Migration `0007_read_tokens.sql` adds the `kind` of a token.

### Patch Changes

- [`6109c83`](https://github.com/hollware/hollware/commit/6109c832f1a789d856f8c5af13674b92aff08606) Thanks [@sergioazoc](https://github.com/sergioazoc)! - `hollware import --publish` with a token without `content:publish` asks for a review of each entry: the server refuses a group from it, and the import then sends each entry on its own.
- Updated dependencies [[`43333d3`](https://github.com/hollware/hollware/commit/43333d309843e464c47b20412d2d1d05738c835a), [`a7b5f26`](https://github.com/hollware/hollware/commit/a7b5f261d08bf8b58e3dc98ee0a7148de71d394b)]:
  - @hollware/core@0.4.0

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
