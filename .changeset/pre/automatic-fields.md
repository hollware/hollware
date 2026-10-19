---
'@hollware/core': minor
'@hollware/server': minor
'@hollware/admin': minor
'hollware': minor
---

Fields Hollware fills itself: a collection's `automaticFields` names them and how, `firstPublished` (the date an entry first went out; a date written wins), `lastModified` (the date of a change published after that), `readingTime` (minutes at 200 words a minute) and `wordCount`. Nobody writes them: they are never required, `describe_site` marks them `readOnly`, and the admin's entry form leaves them out. A site reads them filled (RPC, the read API, `createHollware()`), `get_entry` answers their values as `automatic`, and `hollware export --published` writes them into the frontmatter; the Markdown stored stays what was written. The admin chooses them per field on the page of a collection, and a new blog fills its `date`.
