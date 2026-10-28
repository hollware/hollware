---
'@hollware/core': minor
'@hollware/server': minor
---

Webhooks get the events of a review: `review.requested` when someone without `content:publish` asks to publish, and `review.decided` when the review is approved, sent back for changes, rejected or cancelled by a new revision. Each one carries the review, its entry and `adminPath`, where the admin opens it, and `parseHollwareEvent` reads it. They reach the webhooks at the next sweep of the cron, within a minute, and never IndexNow. Migration `0024` adds them to the outbox.
