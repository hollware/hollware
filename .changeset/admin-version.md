---
'@hollware/admin': minor
'@hollware/server': minor
---

The admin shows the version of Hollware installed at the foot of its sidebar, and links to the notes of a newer release when npm has one. The Worker asks npm at most every six hours, through `GET /v1/admin/version`.
