---
'@hollware/core': minor
'@hollware/server': minor
'@hollware/admin': minor
---

The daily backups of a site are configurable: `backups` of its definition turns them off (`enabled: false`) or keeps each one from 1 to 365 days (`retentionDays`, 30 by default), over MCP with `update_site` or in the admin under Site → Backups. A site that turns them off gets no new backup, and the ones it kept go when their retention passes. Backups hold the content only, never the images, which are in the bucket already.
