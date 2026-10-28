---
'@hollware/server': minor
'@hollware/admin': minor
'hollware': minor
---

A personal token expires after 90 days unless its maker asks for other days or for none: `hollware token create` takes `--no-expiry`, the admin's Tokens page has a "Never expires" box, and `POST /v1/admin/tokens` takes `expiresInDays: null`. A read token still never expires unless it is given days.
