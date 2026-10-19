---
'@hollware/core': minor
'@hollware/server': minor
'@hollware/admin': minor
---

An entry can leave the site at a time: `schedule_unpublish` (MCP) and "Unpublish later" in the admin keep a published entry live until then, and the cron unpublishes it in the name of who scheduled it, if they may still publish. `get_entry` says when, as `unpublishAt`; null cancels it, and an unpublish before the time drops it.
