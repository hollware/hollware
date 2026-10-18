---
'@hollware/core': patch
---

A collection may not be named `admin`, `assets`, `ops`, `search` or `site`: those are routes of the read API under `/v1/`, which a collection of that name could never be read past.
