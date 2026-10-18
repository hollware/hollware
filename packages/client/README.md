# @hollware/client

Reads [Hollware](https://hollware.com) from a site: one typed interface over a Cloudflare service
binding, which needs no network and no token, or over HTTP with a read token.

```ts
import { createClient, hollwareBinding } from '@hollware/client'

// On Cloudflare, with a service binding HOLLWARE to the Hollware entrypoint:
const hollware = hollwareBinding(env.HOLLWARE)
// Anywhere else, over the read API:
const overHttp = createClient({ url: 'https://cms.example.com', token: env.HOLLWARE_TOKEN })

const post = await hollware.getEntry('my-site', 'blog', 'hello', 'en', { formats: ['html'] })
```

It also has the preview links of drafts (`previewRedirect`, `previewTokenFromCookie`) and, in
`@hollware/client/webhooks`, `verifyWebhook` with no zod. `@hollware/nuxt`, `@hollware/astro`,
`@hollware/react` and `@hollware/vue` are built on it.

See [Read content from a site](https://hollware.com/docs/read-from-a-site/).

## Links

- Docs: <https://hollware.com>
- Repository: <https://github.com/hollware/hollware>
- License: MIT
