---
'create-hollware': patch
---

A new project passes its own `vp check`: the starter formats and lints as Hollware writes it (no semicolons, single quotes, generated files left alone), has a `check` script, and `npm create hollware` formats the project after the install, so a longer name than the starter's never leaves a line too wide. Its `AGENTS.md` says how to update Hollware: every package to one exact version, then `hollware deploy`.
