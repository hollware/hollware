---
'@hollware/server': patch
---

An analytics provider that answers more than 2 MB is refused as invalid instead of being read whole into the Worker's memory.
