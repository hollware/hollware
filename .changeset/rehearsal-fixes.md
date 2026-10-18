---
'@hollware/server': patch
'hollware': patch
'create-hollware': patch
---

What a rehearsal of moving a real site into Hollware turned up. A database that lacks the migrations of its release answers a 503 `not_migrated` that names the command to run, instead of a bare 500. `hollware import` shows an unchanged entry with the verdict of this run, not the one kept since it was written, which a change of the site's definition can have made stale. `npm create hollware` prints how to connect an agent once (init's block, which names `HOLLWARE_TOKEN`, never the token), and starts the project with `hollware dev`.
