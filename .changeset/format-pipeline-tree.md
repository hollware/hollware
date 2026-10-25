---
'@hollware/core': patch
---

Formatting a write no longer drops text Hollware leaves out, such as the rest of a component's opening line or braces in prose: the write keeps it as written and reports it. A write parses its Markdown once more at most, not twice.
