# @hollware/nuxt

## 0.4.0

### Minor Changes

- [`f17f026`](https://github.com/hollware/hollware/commit/f17f0268a90aee17c468bea37a9c1df7165c17a8) Thanks [@sergioazoc](https://github.com/sergioazoc)! - `@hollware/nuxt`, a Nuxt module that reads Hollware: over a service binding on Cloudflare, or over HTTP with a read token elsewhere, which stays on the server. `useHollwareEntry`, `useHollwareEntries`, `useHollwareTranslations` and `useHollwareSite` read through the site's own `/_hollware/` routes; `<HollwareContent>` renders an entry's Comark document; every page says `generator: Hollware`.

### Patch Changes

- [`1ce3486`](https://github.com/hollware/hollware/commit/1ce3486200639492118e37226d804d54da6391dd) Thanks [@sergioazoc](https://github.com/sergioazoc)! - `useHollwareEntries` takes `{ lazy: true }` as a third argument, and the module exports the `PageEntry` type of what a page gets.
- Updated dependencies []:
  - @hollware/client@0.4.0
