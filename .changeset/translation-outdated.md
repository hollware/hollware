---
'@hollware/core': minor
'@hollware/server': minor
'@hollware/admin': minor
---

A translation says when its source moved past it: `translationOutdated` is true for an entry in another locale than the site's default whose source, the entry of its group in the default locale, was changed after it was saved, until it is saved again. In list_entries, get_entry and get_translations; the admin marks it "behind its source" and filters by it.
