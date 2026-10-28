---
'@hollware/admin': minor
'@hollware/server': minor
'hollware': minor
---

The editor of the admin writes far fewer revisions. It saves 8 seconds after the last change, and at least once a minute while the typing goes on, instead of a second and a half after each pause; it also saves when the tab is hidden, the page is left or another entry opens, such as a translation. Until then the browser keeps what was typed, so a crash loses nothing: the next time the entry opens, the changes come back with a notice, to keep or discard, and changes kept for an older version are offered rather than applied. Home shows an owner how big the database of the deployment is, against the 500 MB of a D1 database on the Free plan (`GET /v1/admin/database`), and `hollware doctor --remote` says it too.
