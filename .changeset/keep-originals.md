---
'@hollware/core': minor
'@hollware/server': minor
'@hollware/admin': minor
'hollware': minor
---

`media.keepOriginals` (true by default): a site that sets it to `false` keeps only the file it serves and its copies, not the file as it was uploaded, which takes less storage in R2. The download of an original then gives the file served, and `hollware export` names each image by what its bytes are. The admin sets it under Site → Images.
