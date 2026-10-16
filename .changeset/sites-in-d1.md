---
'@hollware/server': minor
'@hollware/core': minor
---

The sites live in D1 (ADR-033). Migration `0011_structure` gives `sites` a definition, a version and `deleted_at`, and adds `site_changes`. The Worker reads the sites from D1 through a registry that polls their versions at most once a second per isolate and compiles again only a site that changed, keeping the last good copy of one that stops compiling. `createHollware()` takes no config; a 0.x config, when given, moves into D1 on the first request for the sites that have no definition, and is never read again. `HollwareConfig.sites` is optional, so `createHollware({ auth })` sets the options of the deployment alone.
