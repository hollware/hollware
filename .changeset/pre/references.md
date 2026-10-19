---
'@hollware/core': minor
'@hollware/server': minor
'@hollware/client': minor
---

Entries can refer to entries of another collection: the rule `reference` of the catalog (a field, a collection, and optionally a locale) checks that each slug a field names exists when writing, and is published to publish. `get_entry` with `references: true` (MCP, RPC, `?references=true`, and `createHollware().getEntry(…, { references: true })`) answers the published entries each field names, in its order: an author, a series, the event of a talk.
