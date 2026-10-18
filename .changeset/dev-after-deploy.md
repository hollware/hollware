---
'hollware': patch
'create-hollware': patch
---

A project keeps working at localhost after `hollware deploy`: the starter's `vite.config.ts` sets `HOLLWARE_PUBLIC_URL` to `http://localhost:5199` in development (`vp dev`), whatever public URL the deploy wrote into `wrangler.jsonc`, and `hollware dev` waits for the server there. `hollware deploy` writes `worker-configuration.d.ts` again whenever it rewrites `wrangler.jsonc`, so `wrangler types --check` keeps passing.
