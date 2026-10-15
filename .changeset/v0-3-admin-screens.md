---
'@hollware/admin': minor
'@hollware/core': minor
'@hollware/server': minor
---

The admin's screens. A person signs in with their passkey (the admin is the server's own OAuth client, with PKCE, and keeps its token in memory), lists the entries of a collection, creates a draft from the fields its collection requires, edits the Markdown in CodeMirror with the verdict as diagnostics and the saved revision's HTML beside it, saves, and publishes, acknowledging warnings when asked; without `content:publish`, publishing asks for a review. The review queue shows what is live beside the revision asked for, with its verdict, and approves it or asks for changes. A review now carries `requestedByName`.
