---
'@hollware/core': patch
---

`stringifyBody` and the canonical Markdown write the props of a component inline however many it has, instead of a `yaml [props]` block that the parser does not read.
