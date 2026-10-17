---
'@hollware/server': minor
---

A person manages their own sign-in over `/v1/admin/account`: they list and remove their passkeys (never the last one), list and revoke the apps they connected, and end every session at once, and `POST /authorize/signout` signs one browser out.
