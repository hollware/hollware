---
'hollware': patch
---

`hollware deploy` says why wrangler failed in full, over every line of a wrapped `[ERROR]`, and suggests `wrangler login` only when wrangler's failure is about logging in. Its closing line no longer says the deploy wrote ids into `wrangler.jsonc`: wrangler now binds what it creates to the deployed Worker by name.
