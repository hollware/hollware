---
'@hollware/core': minor
'@hollware/server': minor
'@hollware/admin': minor
---

Entries have a trash: `delete_entry` moves a draft there and cancels its pending review, `restore_entry` brings it back as the draft it was, `list_entries` lists it with `trashed: true`, every summary carries `deletedAt`, `create_draft` answers `in_trash` for the slug a trashed entry keeps, migration `0014_entry_trash` adds the column, and the admin trashes a draft from the editor and lists, trashes and restores entries in bulk under the filter "In the trash".
