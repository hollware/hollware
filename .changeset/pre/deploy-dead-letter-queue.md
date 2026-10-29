---
'hollware': patch
'create-hollware': patch
---

`hollware deploy` creates the dead-letter queue of the events when it does not exist yet: wrangler creates the other queues, the database, the KV namespace and the buckets of a new project by itself, but stopped the first deploy at a dead-letter queue it does not make. `npm create hollware .` no longer says `cd .`, and the README of `create-hollware` lists every option of `--help`.
