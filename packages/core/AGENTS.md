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

Where things are:

- `src/operations/specs.ts`: the operation specs, sorted by name, which is the order in
  which MCP lists the tools. A new operation adds its spec there, its handler in `packages/server/src/ops`, and
  its row in the table of `tests/operations.test.ts`. Inputs are strict objects; outputs are flat
  objects with an `outcome`, whose values match the spec's `outcomes`.
- `src/config/`: the types of `hollware.config.ts` and the `define*` helpers. Inside
  `defineCollection`, write contracts as plain objects: their `check` then gets the frontmatter
  type of the schema. `defineContract<Frontmatter>` is for a contract shared by collections.
- `src/contracts/types.ts` and `src/markdown/types.ts`: the shapes the contracts and the Markdown
  pipeline share with the server.
- `src/tokens.ts`, `src/scopes.ts`, `src/ids.ts` and `src/errors.ts`: the personal token format,
  the scopes, prefixed ULIDs and `HollwareError`.
