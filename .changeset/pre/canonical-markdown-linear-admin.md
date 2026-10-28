---
'@hollware/core': minor
'@hollware/server': minor
'@hollware/admin': minor
---

One style of Markdown for people and agents. `create_draft` and `update_draft` store the canonical Markdown of Comark (`formatMarkdown` in `@hollware/core`) whenever it means the same document, and answer it as `markdown`; the same file in another style answers `unchanged`. Older revisions keep their bytes; an entry takes the canonical form at its next write.

The admin is laid out like Linear. An entry is a page with its title and its body in a visual editor (TipTap through Nuxt UI): `/` inserts blocks and the components of the collection, a selection gets a bar of formats, blocks drag and move, Comark components are cards with their props, and anything the editor does not know stays a Markdown block. It saves by itself, writes with the same Comark writer the server uses, and opens a file it cannot keep byte for byte in the Markdown view (⌘⇧M). Properties, checks and a live preview, rendered with the pipeline of `@hollware/core`, sit in a side panel; history sits under the body; Publish is the one action of the bar and the rest is in the `⋯` menu. Entries are a list grouped by status with views, filters, keyboard moves (J, K, X) and a floating bar for many at once. Settings (site, collections, people, tokens, activity, account) have their own section at `/settings`; the old paths are gone. `?` lists the shortcuts.

A violation may carry `code`, which kind of problem of its contract it is, and `params`, the values its message names, so a client can say it in another language; the admin shows the checks in Spanish from them, and the English `message` and `fix` stay as they were. The entry's side panel holds Properties and History; the live preview is gone, since the editor shows the page as it reads.
