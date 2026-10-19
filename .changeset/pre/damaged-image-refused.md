---
'@hollware/server': patch
---

`upload_asset` refuses an image that Cloudflare Images cannot decode (error 9516, such as a PNG cut short) with what to do, instead of failing with a server error.
