---
'create-hollware': patch
---

A new project's local server has a `HOLLWARE_SECRET` of its own, for development only, so preview links and the secrets of webhooks work before the first deploy; a `.dev.vars` with `HOLLWARE_SECRET` takes its place.
