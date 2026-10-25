---
'@hollware/core': patch
---

A write costs less CPU: it is formatted with one pass of the pipeline, checked against the tree of the file as written, and linkify's slow pretest runs only on text with an `@` or a `//`.
