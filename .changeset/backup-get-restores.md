---
'hollware': minor
'create-hollware': patch
---

`hollware backup get` writes a backup as an export would: the entries and site.json, `redirects.json` with the 301s of the entries that moved, and the images of the site in `_assets`, which `hollware import` uploads again. An image whose original the deployment no longer has is named and left out. A new project binds the R2 bucket `BACKUPS`, `<name>-backups`, so its backups live apart from its images, and `hollware doctor` says whether a project has one.
