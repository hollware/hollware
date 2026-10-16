---
'@hollware/core': minor
'@hollware/server': minor
---

Six operations change the structure of the sites with no deploy (ADR-033), under the scope `schema:admin` that owners have: `get_structure` reads the definition, its version and the catalog of rules; `update_site` and `set_collection` replace the definition or one collection at the version read, answering every problem at its path, and asking to confirm a change that strands entries (a removed collection or locale) or that a new schema refuses (with counts and slugs); `create_site` makes a site with its maker as owner; `delete_site` puts a site its owner confirms in the trash, and `restore_site` brings it back. Every change is appended to `site_changes` with its actor, and the Worker serves it at once.
