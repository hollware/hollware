# @hollware/core

Contracts, schemas and the Markdown pipeline. Boundary rules for this package:

- No Cloudflare or Workers APIs and no Node-only APIs in `src`: the package must run
  anywhere (Workers, Node, browsers).
- Never read `process.env`: configuration arrives as arguments.
