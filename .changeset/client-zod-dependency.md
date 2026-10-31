---
'@hollware/client': patch
---

`zod` is a dependency of `@hollware/client`, no longer a peer: its types resolve on a site that never installed zod, where the answers of `search` and `getTranslations` were `any`.
