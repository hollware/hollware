---
'@hollware/core': minor
'@hollware/server': minor
'@hollware/admin': minor
---

The history of an entry, over MCP and in the admin. `list_revisions` lists every revision of an entry, newest first, with who wrote it, when, what the contracts said, and which one the site shows; `get_revision` reads the Markdown of one; `restore_revision` goes back to one, as a new revision, so nothing is ever deleted or rewritten. The admin has a History tab on each entry: a revision opens beside the latest one, and "Restore this version" goes back to it.
