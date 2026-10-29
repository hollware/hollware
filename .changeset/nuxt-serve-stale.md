---
'@hollware/nuxt': patch
---

With `cache: 'purge'`, a change marks its pages stale instead of deleting them, and the edge serves the last good copy of a page while the Worker fails to render it again (`stale-if-error`).
