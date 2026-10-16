---
'@hollware/core': minor
'@hollware/server': minor
---

Cache tags are part of the contract: `entryTag`, `listTag`, `groupTag`, `SITE_TAG`, `tagsOfEntries` and `tagsOfChange` of `@hollware/core` name what a page shows, and every event's payload carries `cacheTags`, the tags the change invalidates (the entry, the list of its collection in its locale, its translations), for a site to purge.
