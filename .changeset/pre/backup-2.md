---
'@hollware/server': minor
'@hollware/core': patch
---

The daily backup is `backup/2`: besides the definition and the Markdown of every entry, it keeps the redirects of the site, with their paths, and the list of its images (id, format, sizes, alt, file name). It goes to the R2 bucket `BACKUPS` when the Worker binds one, apart from the images, and to `MEDIA` without it; `list_backups` and `GET /v1/backups/<date>` read from the same bucket.
