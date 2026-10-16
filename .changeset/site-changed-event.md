---
'@hollware/core': minor
'@hollware/server': minor
---

A change of a site's structure is an event too: `site.changed`, sent to the site's webhooks with the cache tags it invalidates (`site`, and every list of the collections and locales the site had or has, `tagsOfSiteChange`), so a site that caches its pages purges its navigation and lists when a collection, a route or a locale changes, with no publish. The event carries no entry, and IndexNow is not told of it. Migration `0013_site_events` rebuilds the outbox to take it, keeping every event and delivery.
