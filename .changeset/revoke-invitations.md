---
'@hollware/core': minor
'@hollware/server': minor
'@hollware/admin': minor
'hollware': minor
---

An invitation that waits can be revoked, and its link stops working at once: from People in the admin (`POST /v1/admin/invitations/:id/revoke`), or with `hollware invite revoke <id>` after `hollware invite list`. The activity log records it as `invitation.revoke`.
