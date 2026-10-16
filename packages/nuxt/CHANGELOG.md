# @hollware/nuxt

## 0.8.0

### Minor Changes

- [`fb9c085`](https://github.com/hollware/hollware/commit/fb9c085fa4246142f5ba0f7f6f595f77f09241b1) Thanks [@sergioazoc](https://github.com/sergioazoc)! - `hollware.cache: 'purge'` keeps the pages that read Hollware in Cloudflare's Workers Cache, which serves them without running the Worker, each tagged with what it showed (the tags of `@hollware/core`, recorded by the composables and by every read of `useHollware` on the server). Hollware's webhook to `POST /_hollware/webhook`, checked with `NUXT_HOLLWARE_WEBHOOK_SECRET`, purges the tags of what changed, so a publish, an edit or an unpublish shows in seconds everywhere. Errors, writes and responses that read nothing are never kept, and the browser keeps nothing. It needs `"cache": { "enabled": true }` in the site's wrangler.jsonc. `cache: <seconds>` still keeps pages with Nitro's `swr`.

### Patch Changes

- Updated dependencies [[`501174a`](https://github.com/hollware/hollware/commit/501174a4b9cd7e0a5191fa587c09e39f71ff3bd7), [`eaa743d`](https://github.com/hollware/hollware/commit/eaa743d4f6a6cb7ec5977f73379e6f414f43403f), [`f2f2c3d`](https://github.com/hollware/hollware/commit/f2f2c3d6ac6123d26bc1bc0d2b668b61d42afd9d), [`d1ea96e`](https://github.com/hollware/hollware/commit/d1ea96e61df8a7b58e0a9b5e76b85abdddc78a7a), [`3f3cb16`](https://github.com/hollware/hollware/commit/3f3cb16b9779defecc14c95b6607989a3dd22367), [`286149b`](https://github.com/hollware/hollware/commit/286149b7106adb84b5ee02b0433dc780b50be6e3)]:
  - @hollware/core@0.8.0
  - @hollware/client@0.8.0

## 0.7.0

### Minor Changes

- [`aa2c244`](https://github.com/hollware/hollware/commit/aa2c244d80bc2e392c11bbcbe52572068ccb4fd1) Thanks [@sergioazoc](https://github.com/sergioazoc)! - The option `cache` keeps a rendered page for that many seconds and serves it again while a fresh one renders in the background (Nitro's `swr`), so that most requests render nothing: on the Workers free plan, a server-rendered page can cost more than the 10 ms of CPU a request has. Errors and the `/_hollware/` routes are never kept.

### Patch Changes

- Updated dependencies []:
  - @hollware/client@0.7.0

## 0.6.0

### Patch Changes

- Updated dependencies []:
  - @hollware/client@0.6.0

## 0.5.0

### Minor Changes

- [`02b2fe2`](https://github.com/hollware/hollware/commit/02b2fe2afc509bb3fb6a0f0110d1002b50953e26) Thanks [@sergioazoc](https://github.com/sergioazoc)! - Page views without personal data (ADR-031). `POST /events` counts a view that a page of a site sends, as the site, the path and the country, in Analytics Engine through an optional `ANALYTICS` binding; never a cookie, an IP or a user agent. The new tool `content_stats` answers the most read pages of the site over the last days, each with the published entry at its path, read from the SQL API with `HOLLWARE_ANALYTICS_ACCOUNT_ID` and the secret `HOLLWARE_ANALYTICS_TOKEN`. The MCP prompt `refresh_content` walks an agent from what readers read to an updated entry. `@hollware/nuxt` sends the views when its `beacon` option names the Hollware.

### Patch Changes

- Updated dependencies [[`0712311`](https://github.com/hollware/hollware/commit/071231163dbf2bb7f5e3368466c5ed0ea5a3c20c), [`310b3ab`](https://github.com/hollware/hollware/commit/310b3abbadfe303be1c90e4c5009ef99bc08c8e1)]:
  - @hollware/client@0.5.0

## 0.4.0

### Minor Changes

- [`f17f026`](https://github.com/hollware/hollware/commit/f17f0268a90aee17c468bea37a9c1df7165c17a8) Thanks [@sergioazoc](https://github.com/sergioazoc)! - `@hollware/nuxt`, a Nuxt module that reads Hollware: over a service binding on Cloudflare, or over HTTP with a read token elsewhere, which stays on the server. `useHollwareEntry`, `useHollwareEntries`, `useHollwareTranslations` and `useHollwareSite` read through the site's own `/_hollware/` routes; `<HollwareContent>` renders an entry's Comark document; every page says `generator: Hollware`.

### Patch Changes

- [`1ce3486`](https://github.com/hollware/hollware/commit/1ce3486200639492118e37226d804d54da6391dd) Thanks [@sergioazoc](https://github.com/sergioazoc)! - `useHollwareEntries` takes `{ lazy: true }` as a third argument, and the module exports the `PageEntry` type of what a page gets.
- Updated dependencies []:
  - @hollware/client@0.4.0
