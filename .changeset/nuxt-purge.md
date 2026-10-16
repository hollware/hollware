---
'@hollware/nuxt': minor
---

`hollware.cache: 'purge'` keeps the pages that read Hollware in Cloudflare's Workers Cache, which serves them without running the Worker, each tagged with what it showed (the tags of `@hollware/core`, recorded by the composables and by every read of `useHollware` on the server). Hollware's webhook to `POST /_hollware/webhook`, checked with `NUXT_HOLLWARE_WEBHOOK_SECRET`, purges the tags of what changed, so a publish, an edit or an unpublish shows in seconds everywhere. Errors, writes and responses that read nothing are never kept, and the browser keeps nothing. It needs `"cache": { "enabled": true }` in the site's wrangler.jsonc. `cache: <seconds>` still keeps pages with Nitro's `swr`.
