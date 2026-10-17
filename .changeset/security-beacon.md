---
'@hollware/server': patch
---

The beacon (`POST /events`) refuses a body over its limit before reading it, by its declared length or as it streams, and answers a site it does not serve as it answers a page of another origin, so it never tells which site keys exist.
