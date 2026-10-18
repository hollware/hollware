---
'@hollware/server': patch
'@hollware/client': patch
---

A preview read on a Hollware without `HOLLWARE_SECRET` is refused as `invalid_preview`, like any refused preview link, so a site drops its preview cookie and shows the published page instead of an error.
