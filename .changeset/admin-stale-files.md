---
'@hollware/admin': patch
---

A page of the admin loaded before a deploy no longer breaks when it asks for a file the new version does not have: it loads the new version, at the page the person was going to (at most once in ten seconds, so a file that is truly missing still shows its error).
