---
'@hollware/client': minor
'@hollware/core': minor
---

`@hollware/client/webhooks` (and `@hollware/core/webhooks`): `verifyWebhook`, `signWebhook` and the header names, with no zod and no other import. A site whose own zod is another major, such as a Nuxt Content site on zod 3, checks Hollware's webhooks through it: the root entry evaluates every schema of Hollware with the site's zod, and fails at load.
