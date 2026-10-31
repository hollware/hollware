---
'@hollware/nuxt': minor
---

Every composable takes `{ lazy, server }` last, as `useFetch` does, so a prerendered page can read in the browser only. `useHollwareTags(tags)` and `hollwareTags` give a page the cache tags of what a route of its own read, so `cache: 'purge'` keeps and purges it. `@nuxt/kit` is a peer dependency, so a site installs the one its Nuxt brings.
