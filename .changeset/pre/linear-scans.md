---
'@hollware/core': patch
'@hollware/server': patch
'@hollware/client': patch
'@hollware/admin': patch
'@hollware/agents': patch
'hollware': patch
---

An upload that opens on an XML declaration and many comments no longer stalls the check of its format, and a URL or a path with thousands of trailing slashes no longer takes seconds to trim: both are read in linear time.
