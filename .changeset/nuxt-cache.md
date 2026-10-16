---
'@hollware/nuxt': minor
---

The option `cache` keeps a rendered page for that many seconds and serves it again while a fresh one renders in the background (Nitro's `swr`), so that most requests render nothing: on the Workers free plan, a server-rendered page can cost more than the 10 ms of CPU a request has. Errors and the `/_hollware/` routes are never kept.
