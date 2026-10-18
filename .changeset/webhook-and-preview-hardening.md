---
'@hollware/core': patch
'@hollware/client': patch
---

`verifyWebhook` answers false for an empty secret instead of throwing, and the exchange of a preview link always redirects to a path of the site: a link whose path starts with `//` or `/\` no longer sends the browser to another host.
