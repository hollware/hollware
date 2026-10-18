---
'@hollware/core': minor
'@hollware/server': minor
'@hollware/client': minor
'@hollware/admin': minor
'hollware': minor
---

An entry can change its slug: `move_entry` (MCP) and "Change URL" in the admin give it another path and keep its revisions and translations. An entry that was ever published keeps its old slug as a redirect, which `list_redirects`, the RPC method `listRedirects`, `GET /v1/redirects`, `createHollware().redirectFor()` and the admin's Site page answer, so a site serves the old path with a 301; `hollware export --published` writes them to `redirects.json`. Moving a published entry takes content:publish and purges its pages.
