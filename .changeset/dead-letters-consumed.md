---
'hollware': minor
'create-hollware': patch
---

A new project consumes the dead-letter queue of its events, `<name>-events-dlq`, so Hollware keeps the events it gave up on for the admin to send again. `hollware doctor` says when the consumer of the events has no dead-letter queue, or when nothing consumes it. A project made before adds `{ "queue": "<name>-events-dlq" }` to `queues.consumers` in its wrangler.jsonc.
