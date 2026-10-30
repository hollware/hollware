---
'@hollware/core': minor
'@hollware/server': minor
'@hollware/client': minor
'@hollware/nuxt': minor
'@hollware/vue': minor
'@hollware/astro': minor
'@hollware/react': minor
---

A collection may declare `navigation: { groupBy, groups, orderBy }`: a string or enum field that groups its entries, the groups in order (an enum's own order when none are given), and a number field that orders each group before the title. `getNavigation(site, collection, { locale })` answers the published entries of a locale arranged that way, with their title, description, path and order, over RPC, `GET /v1/:collection/navigation` and the client (`HollwareReader.getNavigation`, `createHollware().getNavigation`). A collection without one is a single group by title; more than 1,000 published entries in the locale are refused. The `docs` preset groups by `section` and orders by `order`. `@hollware/nuxt` adds `useHollwareNavigation` and `/_hollware/navigation/:collection`, `@hollware/vue` `useHollwareNavigation`, and `@hollware/astro` `hollwareNavigation`.
