# @hollware/nuxt

The Nuxt module of Hollware. Boundary rules for this package:

- Reads only: it reaches Hollware through `@hollware/client` (`HollwareReader`), never MCP.
- A token never reaches the browser: pages read through the module's `/_hollware/` server
  routes, and the token lives in server-only runtime config.
- The link `?hollware-preview=<token>` is exchanged once (`src/runtime/server/preview-exchange.ts`): a
  `303` to the URL without it and the token in the `hollware_preview` cookie. A request with the
  cookie reads the latest revision of that one entry (the `/_hollware/entry` route reads the cookie,
  `useHollwareEntry` adds nothing to the URL), and nothing may keep what it answers: no cache tag,
  `no-store`, and Nitro's cache (`cache: <seconds>`) varies on a header that only
  `src/runtime/server/preview.ts` sets, fresh for each preview. The cookie is cleared only when
  Hollware says the token expired or is not valid, never for another entry's token. The shape, the
  cookie and the URL without the parameter are pure functions of `@hollware/client`.
- A page gets an entry trimmed to what readers see (`forPage`): no verdict, revision or
  publication record goes into the payload.
- The runtime (`src/runtime`) is built file by file (`unbundle`), because Nuxt adds each file to
  the app it builds.
- `examples/nuxt-blog` is its proof: `apps/playground/test/harness/nuxt-site.test.ts` builds it
  and reads the playground over the service binding.
