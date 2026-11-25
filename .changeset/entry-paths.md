---
'@hollware/core': minor
'@hollware/server': minor
'@hollware/client': minor
'@hollware/nuxt': minor
'@hollware/astro': minor
'@hollware/vue': minor
'@hollware/react': minor
---

Reads give each entry its public `path`: `getEntry`, `listEntries`, `getTranslations`, `search` and the references of an entry, over RPC, HTTP and MCP, by the route of its collection in its locale, or `null` without one. A site builds its sitemap and hreflang links without repeating its routes.
