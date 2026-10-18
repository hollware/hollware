---
'hollware': minor
---

`hollware deploy --url https://cms.example.com` now serves the Worker there: a public URL on a domain of your own (not workers.dev) gets a `custom_domain` route in `wrangler.jsonc` before the first deploy, so Cloudflare makes its DNS record and its certificate, and the Worker is deployed once. A config with routes of its own is left as it is, and deploy says which route is missing.
