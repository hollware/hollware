---
'@hollware/core': minor
'@hollware/server': minor
'@hollware/admin': minor
'hollware': minor
---

Read tokens and CORS for the read API (ADR-028). A read token (`hw_read_`) reads the published content of one site over `GET /v1/…` and is refused everywhere else; make one with `hollware token create --read` or in the admin. A site lists the origins of its pages in `cors.origins`, and those pages may read it from the browser. Migration `0007_read_tokens.sql` adds the `kind` of a token.
