---
'@hollware/server': patch
---

The history of the structure of the sites (`site_changes`) is append-only, as revisions and publications are: migration `0015_site_changes_append_only` adds triggers that abort deleting, changing or replacing a line.
