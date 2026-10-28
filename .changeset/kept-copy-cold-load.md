---
'@hollware/admin': patch
---

The editor reads the copy the browser kept once it knows who is signed in: on a page loaded cold, the entry could arrive first, and the copy of a tab that closed was ignored. Typing back to the saved text also says Saved again, instead of Unsaved changes until the next save.
