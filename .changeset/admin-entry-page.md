---
'@hollware/admin': minor
---

The entry page edits nested frontmatter: an object is a group of fields and a list of objects a list of cards to add, remove and reorder, two levels down and more; a list of choices is a multi-select. A singleton collection opens its one entry, created on first visit, and shows as a page or as settings. A side pane shows the site's page as you write, reloaded after each save, at desktop, tablet or phone width (⌘⇧P), or another translation read only beside the editor (⌘⇧L).

Opening the side pane closes the properties panel, which comes back with ⌘⇧I. A review and a compared translation show each component of the body as a block with its name, its props and its named slots, instead of nothing.

The menu of an entry groups what it does: publishing first, then the ways to see it ("Show the draft beside the editor", "Open the draft in a new tab", "Open the published version", "Compare with the es version"), then the tools ("Check for errors", "Change URL"), with each label saying which version it shows.

The live preview follows the writing as it happens, without saving and without reloading: on a site whose integration answers the pane (`@hollware/nuxt`), the admin sends the page what the unsaved Markdown makes (`POST /v1/admin/preview/document`, read as the site reads it) a moment after each change, and the page takes it in place. On another site, the pane reloads after each save.
