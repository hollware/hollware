---
'@hollware/core': minor
'@hollware/server': minor
---

Security: a site's definition can no longer send a secret of the Worker out. IndexNow's `key` is the key itself now, which is public (8 to 128 letters, digits or hyphens; `INDEXNOW_KEY`), not the name of a Worker secret, and a webhook may not name a secret of Hollware or of Cloudflare (`HOLLWARE_*`, `CLOUDFLARE_*`, `CF_*`). Before, an owner of one site, or an agent with `schema:admin`, could name `HOLLWARE_SECRET` as an IndexNow key and have its value sent to IndexNow. A stored definition of the old form is served with IndexNow off, and logs `indexnow_off`; set the key itself to turn it on. The sign-in page also goes back only to a page of its own origin: a `return_to` such as `/\evil.example` could send a person to another host after their passkey.
