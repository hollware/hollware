---
'@hollware/server': patch
---

The secrets Hollware seals under `HOLLWARE_SECRET` (those of webhooks) are bound to the site and the name they are stored under: a sealed value moved to another row of D1 no longer opens there. Values sealed before (`v1.`) still open.
