# @hollware/core

Contracts, operation specs, schemas and the Markdown pipeline. A spec has no handler: those
live in `packages/server` (ADR-017). Boundary rules for this package:

- No Cloudflare or Workers APIs and no Node-only APIs in `src`: the package must run
  anywhere (Workers, Node, browsers).
- Never read `process.env`: configuration arrives as arguments.
