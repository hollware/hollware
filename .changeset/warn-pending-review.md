---
'@hollware/admin': minor
'@hollware/server': minor
'@hollware/core': minor
---

An entry that waits for review says so in the editor, with a link to its review, and a change to it is not saved until the person chooses: discard it, review the request, or save and cancel the request. Before, an autosave cancelled the request of the author without a word. `list_reviews` takes `entryId` to list the requests of one entry, and Reviews opens the one named in `?review=`.
