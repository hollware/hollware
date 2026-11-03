---
'@hollware/client': patch
'@hollware/server': patch
---

The HTTP client sends a preview token in the `hollware-preview` header, not in the URL, and the read API accepts it there (the `preview` query parameter still works). The client also refuses an answer whose outcome or fields it does not know, as `invalid_response`, instead of handing it on.
