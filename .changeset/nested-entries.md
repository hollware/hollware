---
'@hollware/core': minor
'@hollware/server': minor
---

Nested entries. A collection with `nesting: { maxDepth }` (2 to 10) lets an entry have a parent of its collection and locale: `create_draft` takes `parent`, and `move_entry` moves an entry, with its descendants, under another parent or to another place among its siblings. An entry's path holds the slugs of its ancestors in place of `:slug`, so `/help/billing/refunds/` is the entry `refunds` under `billing`. Slugs stay unique in a collection and locale: `resolvePath` (RPC, and `GET /v1/resolve?path=`) answers the entry a path names, or the path it has now for an older one. `getNavigation` answers a tree, and `get_entry` the ancestors of an entry for breadcrumbs. A child is published only with its ancestors; an entry with children is neither unpublished, trashed nor deleted for ever, and one whose parent is in the trash is not restored. A collection's depth is never set below the deepest entry it has.
