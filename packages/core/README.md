# @hollware/core

The contracts, operation specs, schemas and Markdown pipeline of
[Hollware](https://hollware.com), an open-source headless CMS for the agent era, native to
Cloudflare Workers.

It has no Cloudflare dependencies, so it runs anywhere: in the Worker, in a site, in a test.

- **Operations:** the spec of every MCP tool and operation (`OPERATIONS`): its name, its input and
  output schemas, its scopes and its effect.
- **Contracts:** the rules every write is checked against, and the verdict they return.
- **Markdown:** `processMarkdown` and `renderHtml`, the pipeline Hollware stores and renders with.
- **Events and caching:** `parseHollwareEvent`, `verifyWebhook` and the cache tags of each event
  (`entryTag`, `listTag`, `tagsOfChange`). `@hollware/core/webhooks` has the signature alone, with
  no zod.

Most projects never import it directly: `@hollware/server` runs it, and the integrations
(`@hollware/nuxt`, `@hollware/astro`, `@hollware/react`, `@hollware/vue`) read through
`@hollware/client`.

## Links

- Docs: <https://hollware.com>
- Repository: <https://github.com/hollware/hollware>
- License: MIT
