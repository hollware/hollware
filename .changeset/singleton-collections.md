---
'@hollware/core': minor
'@hollware/server': minor
---

A collection may be a singleton (`singleton: true`): one entry per locale at most, such as a home page or the settings of a site. A second `create_draft` in a locale is refused with its fix. Its routes are fixed paths without `:slug` (`{ en: '/', es: '/es/' }`), which links, `resolvePath` and preview links find, or there are none. `describe_site`, `get_structure`, `set_collection` and `update_site` carry the flag, and a stored definition without it is no singleton.
