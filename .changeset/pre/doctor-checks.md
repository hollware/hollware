---
'hollware': patch
---

`hollware doctor` also checks the cron trigger, the events queue (its producer and its consumer) and the rate limit `HOLLWARE_RATE_LIMIT`, which a project needs for scheduled publications, webhooks and IndexNow, and limits on sign-in.
