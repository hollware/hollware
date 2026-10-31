---
'@hollware/admin': minor
---

The admin shows what the server holds as it changes: pages read through shared queries of Pinia Colada, every write refreshes what is on screen (the count of reviews in the sidebar, the sites, the collections), and coming back to the tab, or the network, reads again. Reviews and the count of what waits are read again every few seconds while the tab is visible, an entry follows a change made elsewhere when it has no unsaved edits, and a settings form saves against the version it was filled from.
