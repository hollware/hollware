# @hollware/nuxt

## 1.0.0-rc.5

### Minor Changes

- [`88965e8`](https://github.com/hollware/hollware/commit/88965e8b3431656e939056cc8cfb7ec0b4206072) Thanks [@sergioazoc](https://github.com/sergioazoc)! - Components to render entries in every framework:

  - `<HollwareImage>` in React, Vue and Nuxt renders the image a frontmatter field holds (a cover) with its alt, its size and the `srcset` of its copies; `imageOf(entry, field)` of `@hollware/client` gives the same attributes for any other renderer. The `images` of a summary carry the alt of each image.
  - `@hollware/astro` exports `HollwareContent.astro`, which renders an entry from its document with the site's own Astro components (`components={{ callout: Callout }}`), through the same rules as the HTML Hollware makes, and `HollwareImage.astro`. Its loaders keep the document and the images of each entry for them.
  - `safeDocument` of `@hollware/core` copies a document through the rules of `renderHtml`, for a renderer of a site's own.

### Patch Changes

- [`406b6f2`](https://github.com/hollware/hollware/commit/406b6f2076de30a0ee92670f0ca598029cb13a5c) Thanks [@sergioazoc](https://github.com/sergioazoc)! - The entries of a Nuxt page carry their `images`, so `<HollwareImage>` gets the size, alt and `srcset` of a cover.
- Updated dependencies [[`88965e8`](https://github.com/hollware/hollware/commit/88965e8b3431656e939056cc8cfb7ec0b4206072)]:
  - @hollware/core@1.0.0-rc.5
  - @hollware/client@1.0.0-rc.5

## 1.0.0-rc.4

### Patch Changes

- Updated dependencies [[`9e93f74`](https://github.com/hollware/hollware/commit/9e93f740a5d3c5fd68d16ea43b2ec79853ab1ee6)]:
  - @hollware/core@1.0.0-rc.4
  - @hollware/client@1.0.0-rc.4

## 1.0.0-rc.3

### Patch Changes

- [`8b8b51f`](https://github.com/hollware/hollware/commit/8b8b51fd057b945b826c2c1a67b3193a713f7483) Thanks [@sergioazoc](https://github.com/sergioazoc)! - Hardening: the reply to a publish question counts only for the entry the call publishes; a webhook secret sealed by 0.8 to 0.10 is sealed again to its site and name when it is read; and the webhook route of `@hollware/nuxt` purges only for events of its own site.
- Updated dependencies [[`8d6edca`](https://github.com/hollware/hollware/commit/8d6edcadbf06f1c4b85c5fe9739fb09a2a1c1f85), [`f31b9fb`](https://github.com/hollware/hollware/commit/f31b9fbbd99f08ab8d094742813f62dc32834d44), [`83f582a`](https://github.com/hollware/hollware/commit/83f582ab6e2483fe94ba7d3953b3b968835443c7), [`e4b8296`](https://github.com/hollware/hollware/commit/e4b8296ac4f525f5ee969f2bcd1cb466b06be3e4), [`1530a5f`](https://github.com/hollware/hollware/commit/1530a5f2a49cc6e47682e123e35a8d45cef4553b), [`0235865`](https://github.com/hollware/hollware/commit/0235865719899057dc58f7888208c16f1e990eda), [`0075a00`](https://github.com/hollware/hollware/commit/0075a0089e21f378c2295b4f26f5626e866bad67), [`29e7ecc`](https://github.com/hollware/hollware/commit/29e7ecc893fcb5f145e53b99a7f158b518e423f3), [`0150c9f`](https://github.com/hollware/hollware/commit/0150c9f4d1be3be699d6987946acd3bc5041e619), [`ea570be`](https://github.com/hollware/hollware/commit/ea570be69416f9a9b87d6d3a449975a42a58ab48), [`1310c51`](https://github.com/hollware/hollware/commit/1310c515a6ee07656aac57f3d5cd0fa0e824dd83), [`cebe6bb`](https://github.com/hollware/hollware/commit/cebe6bb99e776214d595f6223744b3fa670dd8ea), [`d0f43a4`](https://github.com/hollware/hollware/commit/d0f43a433a29618c763a8fde6662f777b4bb00e2), [`5e4bee1`](https://github.com/hollware/hollware/commit/5e4bee1adf9d2e119b90ca4ae3c5e07d8055c260), [`1ab4a4c`](https://github.com/hollware/hollware/commit/1ab4a4c26b492dedc77b1e1289ab883b4a0124d3), [`4c03dd3`](https://github.com/hollware/hollware/commit/4c03dd3f8fb3a366f095b3f8b84c4704819b714f), [`102ea18`](https://github.com/hollware/hollware/commit/102ea18cbc076fbc47f1128b0f71e98e4dd071d8), [`ca4225d`](https://github.com/hollware/hollware/commit/ca4225d3d0a04eb59323c89156ed167ec1b4b905), [`bce8006`](https://github.com/hollware/hollware/commit/bce80069a466f41ee929f33bd11c302b92e9e3a2), [`865c6c7`](https://github.com/hollware/hollware/commit/865c6c75ebd68f3c30993a0f9f346c9188f7843f)]:
  - @hollware/core@1.0.0-rc.3
  - @hollware/client@1.0.0-rc.3

## 1.0.0-rc.2

### Patch Changes

- Updated dependencies [[`f16f745`](https://github.com/hollware/hollware/commit/f16f7452e24037ab564f4442839c26b463019d58), [`51fc47c`](https://github.com/hollware/hollware/commit/51fc47c170d39ce69350c800d287309ba3ebb92e)]:
  - @hollware/core@1.0.0-rc.2
  - @hollware/client@1.0.0-rc.2

## 1.0.0-rc.1

### Patch Changes

- Updated dependencies [[`84d96fd`](https://github.com/hollware/hollware/commit/84d96fdbfe0527c5aae28b52d2d5045c8ec69354)]:
  - @hollware/core@1.0.0-rc.1
  - @hollware/client@1.0.0-rc.1

## 1.0.0-rc.0

### Patch Changes

- Updated dependencies [[`b47f74a`](https://github.com/hollware/hollware/commit/b47f74aefaf518df6cc95b8cf9f33388b488cd22)]:
  - @hollware/core@1.0.0-rc.0
  - @hollware/client@1.0.0-rc.0

## 0.11.0

### Minor Changes

- [`304e18d`](https://github.com/hollware/hollware/commit/304e18d68482c88db6987e2453bcfa0b75467595) Thanks [@sergioazoc](https://github.com/sergioazoc)! - A person in the admin opens the latest revision of an entry, a draft included, on the real site before it is published. "Preview on the site" makes a signed link of one hour for that entry (`hw_prv_…`, `POST /v1/admin/preview`, `preview.create` in the activity log), and `getEntry` takes it as `preview` over the RPC binding, the read API (`?preview=`) and `@hollware/client`; a token that does not hold is an error, never the published version. The token is in the URL once: `@hollware/nuxt` and the new `hollwarePreview()` middleware of `@hollware/astro` answer the link with a `303` to the same URL without `?hollware-preview=` and keep the token in the `hollware_preview` cookie (HttpOnly, SameSite=Lax, one hour, Secure but on localhost), `useHollwareEntry` and the live loader (`getLiveEntry('blog', { id, preview })`) read it from there, a token Hollware refuses as expired or invalid clears the cookie, and a previewed page is never cached. `@hollware/client` exports the pure parts. It needs the Worker secret `HOLLWARE_SECRET`.

### Patch Changes

- Updated dependencies [[`069c95f`](https://github.com/hollware/hollware/commit/069c95f1e940ea4f9ac013cac3a69d5ad5d7732d), [`304e18d`](https://github.com/hollware/hollware/commit/304e18d68482c88db6987e2453bcfa0b75467595), [`ead05f6`](https://github.com/hollware/hollware/commit/ead05f60b7240ede34e78a9f2694a238ac8932a6), [`5e24d98`](https://github.com/hollware/hollware/commit/5e24d987c38466a315bcb3b94c3dfa23de90e71f), [`302cbf6`](https://github.com/hollware/hollware/commit/302cbf6e70012513b6debb63fc3b818f97136ee9)]:
  - @hollware/core@0.11.0
  - @hollware/client@0.11.0

## 0.10.0

### Patch Changes

- Updated dependencies [[`eb4df6d`](https://github.com/hollware/hollware/commit/eb4df6dd3a8eafc7b04266478a2f0950adea0bbc), [`6a8e7b5`](https://github.com/hollware/hollware/commit/6a8e7b57f894722d808f1708b353884ad2f0a6d7), [`ad56b86`](https://github.com/hollware/hollware/commit/ad56b8656041396926ab9b1de602cf15519a5f38), [`75341bf`](https://github.com/hollware/hollware/commit/75341bf1134084e2ac8b316a661ee46fe863b1ca)]:
  - @hollware/core@0.10.0
  - @hollware/client@0.10.0

## 0.9.1

### Patch Changes

- Updated dependencies []:
  - @hollware/client@0.9.1
  - @hollware/core@0.9.1

## 0.9.0

### Patch Changes

- Updated dependencies []:
  - @hollware/client@0.9.0
  - @hollware/core@0.9.0

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
