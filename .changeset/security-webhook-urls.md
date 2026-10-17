---
'@hollware/server': patch
---

`get_structure` shows the URL of a webhook whole only to a token with `schema:admin`; anyone else sees its origin, as a webhook's path and query are often its secret (a deploy hook).
