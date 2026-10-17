# @hollware/vue

Hollware for Vue 3 apps that are not Nuxt (`@hollware/nuxt` serves those). Boundary rules:

- Reads only: it reaches Hollware through `@hollware/client` (`HollwareReader`), never MCP, and
  what it reads is published content. It imports nothing of Cloudflare and no Nuxt module.
- The server helpers (`createHollware`, `previewRedirect`, `previewHeaders`, `previewCookieClear`,
  `isPreviewRequest`) are `@hollware/client`'s, shared with `@hollware/react`, and only re-exported
  here (`tests/reexports.test.ts`). A page that a server renders reads with them.
- The composables are for a browser-only app: they read over HTTP with a read token (`hw_read_`),
  which the page holds, so it must never be a personal token. Hollware allows it from an origin in
  the site's `cors.origins`. There is no preview in the browser: the preview cookie is `HttpOnly`
  on the site's server.
- `<HollwareContent>` renders the Comark document with `@comark/vue`'s `MarkdownDocument`, imported
  from its own subpath so no parser reaches the bundle, as `@hollware/nuxt` renders it. It is a
  plain component, so it renders on the server and hydrates in the browser. `sideEffects: false`
  keeps the rest out of a bundle that imports only the component.
