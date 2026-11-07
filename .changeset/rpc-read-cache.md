---
'@hollware/server': minor
---

The `Hollware` entrypoint keeps the answers of published reads (`getEntry`, `resolvePath`, `listEntries`, `getNavigation`, `getTranslations`, `describeSite`, `listRedirects`) in its isolate, by a tag of the site that D1 gives at each call: the version of its definition and a new content version, which triggers move whenever an entry, a redirect, an asset or an embedding of the site changes. A cached read waits for that one query, which runs beside the refresh of the sites, instead of every query of the read, so a site far from D1 gets its pages in one round trip; a change shows on the next read. `search` is never cached. Two migrations add `sites.content_version` and its triggers.
