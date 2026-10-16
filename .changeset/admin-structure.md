---
'@hollware/admin': minor
'@hollware/server': minor
---

The admin shapes the site with no deploy (ADR-033): Collections lists them and makes one from a preset (a blog, docs, or a title alone); the editor of a collection edits its fields (kind, bounds, choices, required, order), its paths per locale, the fields of translations, tags and order, its rules from the catalog with their parameters, its style guide and its components, and asks to confirm a change that touches existing entries. Site edits the locales, the public URL, the origins that read from the browser and the style guide, makes a new site, puts this one in the trash and restores one. People gives a member another role or removes them. `/v1/admin/me` lists the trashed sites the person owns.
