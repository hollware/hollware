# @hollware/client

The typed Hollware client. Boundary rules for this package:

- One typed interface over two transports, a service binding and HTTP: the caller picks a
  transport, never a different API.
- Never read `process.env`: the binding, or the URL and token, arrive as arguments.
- A preview token travels in a URL once: the site answers a 303 that sets an `HttpOnly` cookie
  (`no-store`, `no-referrer`), so the token stays out of the address bar, the history and a
  `Referer`; `hollware-view`, a new nonce each time, keeps the previewed URL out of every cache.
  `@hollware/nuxt` and `@hollware/astro` only wire these pure parts to their requests.
- `@hollware/client/webhooks` imports only `@hollware/core/webhooks`: a site whose zod is another
  major (Nuxt Content's zod 3) checks deliveries through it (`tests/webhooks-entry.test.ts`).
