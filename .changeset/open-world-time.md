---
'@hollware/server': patch
---

`content_stats` and `connect_analytics` get 30 seconds instead of 10, and a provider of analytics 25 seconds instead of 8: PostHog's query API takes 5 to 15 seconds, so connecting it answered `unreachable`. Every other tool keeps its 10 seconds. The limit is exported as `OPEN_WORLD_TIMEOUT_MS`.
