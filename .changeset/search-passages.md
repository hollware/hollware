---
'@hollware/core': minor
'@hollware/server': minor
'@hollware/client': minor
---

`search` answers, with `passages: true`, the passage each result matched: the whole section of the entry, its heading, and the URL of the entry on the site, what a model reads to answer with your content and cite it (RAG). `minScore` leaves out what matches by meaning less, so a question nothing answers finds nothing. Over MCP, RPC, the read API (`?passages=true&minScore=0.5`) and `createHollware`.
