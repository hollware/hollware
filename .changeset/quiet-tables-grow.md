---
---

`@hollware/server` gets the D1 schema of v0.1: the migrations `0001_core.sql` and `0002_append_only.sql`, generated from `src/db/schema.ts` and kept append-only by triggers (ADR-021, ADR-023), and `@hollware/core` the prefixed ULIDs of its ids. They ship with `0.1.0`, so nothing is released now.
