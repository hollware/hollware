# @hollware/core

Contracts, operation specs, schemas and the Markdown pipeline. A spec has no handler: those
live in `packages/server` (ADR-017). Boundary rules for this package:

- No Cloudflare or Workers APIs and no Node-only APIs in `src`: the package must run
  anywhere (Workers, Node, browsers).
- `src` type-checks against the web platform only (`tsconfig.json`: `lib` es2024 and
  webworker, no `types`), so a Node or browser global is a type error. Tests and configs
  type-check through `tests/tsconfig.json` (ADR-018).
- Every test runs in Node and inside workerd (`vitest.workerd.config.ts`).
- Never read `process.env`: configuration arrives as arguments.
