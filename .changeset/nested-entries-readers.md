---
'@hollware/client': minor
'@hollware/nuxt': minor
'@hollware/vue': minor
'@hollware/astro': minor
'@hollware/react': minor
---

Reading nested entries. `HollwareReader` has `resolvePath`, over a binding and HTTP, and `createHollware` has `getPage(path, options)`: the entry a path of the site names with its `ancestors`, `redirect` with the path it has now for an older one, or `not_found`. Summaries carry `parent` and `slugPath`, and `trailOf` and `flattenNavigation` read the tree of `getNavigation` for breadcrumbs and previous and next. `@hollware/nuxt` serves `/_hollware/page` for `useHollwarePage(path)`; `@hollware/vue` has `useHollwarePage`; `@hollware/astro` gives a nested entry the path of its slugs as id, for a `[...path]` route, and its ancestors in `rendered.metadata`; `@hollware/react` has `<HollwareTree>` and `<HollwareBreadcrumbs>`, unstyled, with the link component of a router.
