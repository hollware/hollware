# @hollware/vue

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
