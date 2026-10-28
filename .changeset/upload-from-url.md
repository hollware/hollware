---
'@hollware/core': minor
'@hollware/server': minor
---

`upload_asset` takes a public https `url` instead of `data`: Hollware downloads the image, at most 10 MB, and keeps it as one sent in base64. An agent no longer has to write out the bytes of an image.
