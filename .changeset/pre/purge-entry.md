---
'@hollware/server': minor
'@hollware/core': minor
'@hollware/admin': minor
---

An owner can delete an entry of the trash for ever, from the trash of Entries in the admin (`POST /v1/admin/entries/:id/purge`): its revisions, publications, reviews and their comments, redirects, schedules and events go with it, and nothing brings it back. The record of the purge (`entry_purges`, who and when) is what lets the append-only triggers delete those rows, and it is never deleted itself; every other revision and publication stays append-only. The activity log records `entry.purge`.
