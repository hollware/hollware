---
'create-hollware': patch
---

A project's tests pass after `hollware deploy`: the starter's `vitest.config.ts` gives the Worker under test `HOLLWARE_PUBLIC_URL=http://localhost:5199`, whatever public URL the deploy wrote into `wrangler.jsonc`. They used to answer 403 in CI, where no `.dev.vars` sets it back to localhost.
