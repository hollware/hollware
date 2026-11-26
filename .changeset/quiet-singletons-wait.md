---
'@hollware/admin': patch
---

Opening a singleton with no entry in the locale no longer creates a draft: the admin shows the form to create it, named after the collection, and writes nothing until the person creates it.
