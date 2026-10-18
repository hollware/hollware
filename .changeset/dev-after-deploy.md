---
'hollware': patch
---

`hollware dev` keeps working after `hollware deploy`: when `wrangler.jsonc` names the public URL, the local server is still `http://localhost:5199`, and `hollware dev` sets `HOLLWARE_PUBLIC_URL` to it in `.dev.vars` (which wrangler reads in development instead of the vars of `wrangler.jsonc`), keeping the rest of that file. It used to wait on the public URL, and the local Worker refused localhost.
