---
'@hollware/core': minor
'@hollware/server': minor
'@hollware/client': minor
'@hollware/nuxt': minor
'@hollware/astro': minor
'@hollware/admin': minor
---

A person in the admin opens the latest revision of an entry, a draft included, on the real site before it is published. "Preview on the site" makes a signed link of one hour for that entry (`hw_prv_…`, `POST /v1/admin/preview`, `preview.create` in the activity log), and `getEntry` takes it as `preview` over the RPC binding, the read API (`?preview=`) and `@hollware/client`; a token that does not hold is an error, never the published version. `useHollwareEntry` of `@hollware/nuxt` and the live loader of `@hollware/astro` (`getLiveEntry('blog', { id, preview })`) read it from the page's URL (`?hollware-preview=`), and a previewed page is never cached. It needs the Worker secret `HOLLWARE_SECRET`.
