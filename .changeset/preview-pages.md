---
'@hollware/core': minor
'@hollware/server': minor
'@hollware/client': minor
'@hollware/nuxt': minor
'@hollware/astro': minor
'@hollware/vue': minor
'@hollware/react': minor
---

A preview of a page that reads several entries shows the draft of the previewed one and the published version of the others, instead of no entry. A link with `hollware-embed=1`, which `POST /v1/admin/preview` gives as `embedUrl`, renders the page in place for the admin's live preview: the token reaches that request alone, with no cookie, `no-store`, `Referrer-Policy: no-referrer` and, in `@hollware/nuxt` with `hollware.url`, `frame-ancestors` of Hollware. The admin page lets the origins of the sites be framed.

The headers of an embedded preview hold for every answer of the site, its error pages included: Nitro answers an error with `X-Frame-Options: DENY` after every hook, which left the live preview blank, and now a missing page or a refused token shows in the pane as the site answers it, framed by Hollware alone and never cached.

The live preview follows the writing without a reload. `POST /v1/admin/preview/document` answers what an unsaved Markdown makes, as the site reads it (images resolved), and saves nothing. In the admin's frame, `@hollware/nuxt` says it is ready (`PREVIEW_READY_MESSAGE`) and takes an entry from its parent window (`PREVIEW_ENTRY_MESSAGE`) in place of the one the page read with the same id; it also keeps the page's scroll when the pane reloads it. A site without this reloads after each save.
