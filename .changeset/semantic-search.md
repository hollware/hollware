---
'@hollware/core': minor
'@hollware/server': minor
'@hollware/client': minor
---

Semantic and hybrid search (ADR-030). `search` takes a `mode`: `fulltext`, `semantic` (by meaning, in any language) or `hybrid`, the default, which merges both; the answer says which mode ran, and a Worker without semantic search answers full text. `get_entry` takes `related: true` and answers the published entries closest to the entry by meaning, in its collection and locale. Over RPC and `@hollware/client` they are the options `mode` and `related`; over the read API, `GET /v1/search?mode=` and `GET /v1/{collection}/{locale}/{slug}?related=true`.
