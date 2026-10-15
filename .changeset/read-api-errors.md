---
'@hollware/server': patch
---

The read API answers an input the caller got wrong with its code and status again: an unknown collection or locale is a 404, a limit out of range a 400. Since the move to Hono 5 they were answered as a 500, because the app's error handler took the error before the read API could.
