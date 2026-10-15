---
'hollware': patch
---

`hollware import --publish` with a token without `content:publish` asks for a review of each entry: the server refuses a group from it, and the import then sends each entry on its own.
