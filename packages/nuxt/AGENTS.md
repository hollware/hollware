# @hollware/nuxt

The Nuxt module of Hollware. Boundary rules for this package:

- Reads only: it reaches Hollware through `@hollware/client` (`HollwareReader`), never MCP.
- A token never reaches the browser: pages read through the module's `/_hollware/` server
  routes, and the token lives in server-only runtime config.
- A request with `?hollware-preview=<token>` reads the latest revision of that one entry
  (`useHollwareEntry` forwards it to the route, the route to the reader), and nothing may keep what
  it answers: no cache tag, `no-store`, and Nitro's cache (`cache: <seconds>`) varies on a header
  that only `src/runtime/server/preview.ts` sets, fresh for each preview.
- A page gets an entry trimmed to what readers see (`forPage`): no verdict, revision or
  publication record goes into the payload.
- The runtime (`src/runtime`) is built file by file (`unbundle`), because Nuxt adds each file to
  the app it builds.
- `examples/nuxt-blog` is its proof: `apps/playground/test/harness/nuxt-site.test.ts` builds it
  and reads the playground over the service binding.
