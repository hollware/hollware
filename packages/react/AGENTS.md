# @hollware/react

The React helpers of Hollware. Boundary rules for this package:

- Reads only: it reaches Hollware through `@hollware/client` (`HollwareReader`), never MCP, and
  what it reads is published content, but for a preview.
- It knows no framework and no runtime: its helpers take a `Request` and answer data, a `Response`
  or `Headers`, so a React Router loader, a Server Component and a server function call them the
  same way. It imports nothing of Cloudflare: a service binding comes through a function the site
  writes (`() => hollwareBinding(env.HOLLWARE)`).
- A loader's data goes to the browser, so `PageEntry` is picked field by field: no verdict, no
  revision, no publication. A token never reaches the browser: the preview cookie is `HttpOnly`
  and only `getEntry` reads it. `sideEffects: false` keeps the helpers out of a client bundle
  that imports only `<HollwareContent>`; `react-router-site.test.ts` proves it.
- A read of a preview answers `preview: true` and the page is `no-store` (`previewHeaders`). The
  shape of the token, the cookie and the URL without the parameter are pure functions of
  `@hollware/client`, shared with `@hollware/nuxt` and `@hollware/astro`. The helpers themselves
  (`createHollware`, `previewRedirect`, ...) live there too, shared with `@hollware/vue`, and this
  package only re-exports them (`tests/reexports.test.ts`).
- `<HollwareContent>` renders the Comark document with `@comark/react`'s `MarkdownDocument`,
  imported from its own subpath so no parser reaches the bundle. It is a plain component, with no
  hook and no `'use client'`, so it serves a Server Component and hydrates in the browser.
- `examples/react-router-blog` is its proof: `apps/playground/test/harness/react-router-site.test.ts`
  builds it and reads the playground over the service binding.
- In React Router a page's headers come only from a `headers` export: the route answers its
  `loaderHeaders`, and the root its `errorHeaders`, the ones of a thrown 404 (`examples/react-router-blog/app/root.tsx`).
