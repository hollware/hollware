# @hollware/vue

## 1.0.0-rc.3

### Minor Changes

- [`e4b8296`](https://github.com/hollware/hollware/commit/e4b8296ac4f525f5ee969f2bcd1cb466b06be3e4) Thanks [@sergioazoc](https://github.com/sergioazoc)! - `createHollware` (and so `@hollware/react` and `@hollware/vue`) reads `search` and `describeSite` too, as the binding and the read API already did: a site's search page needs no reader of its own.

- [`5e4bee1`](https://github.com/hollware/hollware/commit/5e4bee1adf9d2e119b90ca4ae3c5e07d8055c260) Thanks [@sergioazoc](https://github.com/sergioazoc)! - Responsive images: when an image is uploaded, Hollware also makes its narrower copies, the `media.widths` of the site (640 and 1280 pixels by default, `[]` for none), served at `<url>/<width>`. `upload_asset`, `get_asset` and `list_assets` answer `widths` and `srcset`; the HTML of `get_entry`, and the document a site reads, give each image its `srcset`, `sizes`, `width` and `height`; and a summary read by a site (`get_entry`, `list_entries`, `createHollware()`) carries `images`, the size and `srcset` of each image its frontmatter names, by URL, to lay out a cover. The admin sets the format, quality, widest width and copies in Site, and shows the copies of each image. Images uploaded before keep none.

### Patch Changes

- Updated dependencies [[`e4b8296`](https://github.com/hollware/hollware/commit/e4b8296ac4f525f5ee969f2bcd1cb466b06be3e4), [`0150c9f`](https://github.com/hollware/hollware/commit/0150c9f4d1be3be699d6987946acd3bc5041e619), [`ea570be`](https://github.com/hollware/hollware/commit/ea570be69416f9a9b87d6d3a449975a42a58ab48), [`1310c51`](https://github.com/hollware/hollware/commit/1310c515a6ee07656aac57f3d5cd0fa0e824dd83), [`cebe6bb`](https://github.com/hollware/hollware/commit/cebe6bb99e776214d595f6223744b3fa670dd8ea), [`5e4bee1`](https://github.com/hollware/hollware/commit/5e4bee1adf9d2e119b90ca4ae3c5e07d8055c260), [`102ea18`](https://github.com/hollware/hollware/commit/102ea18cbc076fbc47f1128b0f71e98e4dd071d8), [`865c6c7`](https://github.com/hollware/hollware/commit/865c6c75ebd68f3c30993a0f9f346c9188f7843f)]:
  - @hollware/client@1.0.0-rc.3

## 1.0.0-rc.2

### Patch Changes

- Updated dependencies [[`51fc47c`](https://github.com/hollware/hollware/commit/51fc47c170d39ce69350c800d287309ba3ebb92e)]:
  - @hollware/client@1.0.0-rc.2

## 1.0.0-rc.1

### Patch Changes

- Updated dependencies []:
  - @hollware/client@1.0.0-rc.1

## 1.0.0-rc.0

### Patch Changes

- Updated dependencies []:
  - @hollware/client@1.0.0-rc.0

## 0.11.0

### Minor Changes

- [`302cbf6`](https://github.com/hollware/hollware/commit/302cbf6e70012513b6debb63fc3b818f97136ee9) Thanks [@sergioazoc](https://github.com/sergioazoc)! - A new package: Hollware for any Vue 3 app that is not Nuxt. `<HollwareContent>` renders an entry's Comark document with your own Vue components, on the server and in the browser; `useHollwareEntry` and `useHollwareEntries` read published content from a browser-only app (a Vite SPA) over HTTP with a read token, through `createHollwarePlugin`. `@hollware/client` now holds the server helpers that `@hollware/react` had, `createHollware`, `previewRedirect`, `previewHeaders`, `previewCookieClear` and `isPreviewRequest`, so React and Vue share them; `@hollware/react` still exports every one.

### Patch Changes

- Updated dependencies [[`304e18d`](https://github.com/hollware/hollware/commit/304e18d68482c88db6987e2453bcfa0b75467595), [`5e24d98`](https://github.com/hollware/hollware/commit/5e24d987c38466a315bcb3b94c3dfa23de90e71f), [`302cbf6`](https://github.com/hollware/hollware/commit/302cbf6e70012513b6debb63fc3b818f97136ee9)]:
  - @hollware/client@0.11.0
