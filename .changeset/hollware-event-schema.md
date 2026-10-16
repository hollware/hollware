---
'@hollware/core': minor
---

The events of webhooks are a schema of `@hollware/core` now: `hollwareEvent` (with `entryEvent` and `siteEvent`, and their types), and `parseHollwareEvent(body)`, which reads the body of a webhook once its signature holds, and answers null for a body that is no event this version knows.
