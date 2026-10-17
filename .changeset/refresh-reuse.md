---
'@hollware/core': patch
'@hollware/server': patch
---

A refresh token used again after it was spent revokes its grant (T-34). The OAuth library takes the previous refresh token again so a client whose answer was lost can retry; past one minute after the rotation that spent it, Hollware now refuses it, revokes the grant with every token of it, and writes `app.refresh_reused` to the site's activity log.
