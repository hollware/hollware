---
'create-hollware': minor
'hollware': minor
---

`npm create hollware <dir>` makes a project: the starter, every Hollware package at its own version, `git init`, the install, the local migrations, and the site with its owner and a first token, then the `claude mcp add` line for it. `hollware deploy` deploys to Cloudflare, creating the D1 database, the KV namespace and the queues on the first run and setting the public URL of the Worker, and migrates the remote database. `hollware doctor` checks a project and says what to fix. `hollware migrate --remote` takes no backup of a database that has none of the migrations yet.
