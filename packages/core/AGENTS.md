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
- `src/markdown/`: the Markdown pipeline (ADR-001, ADR-020). `processMarkdown` answers for any
  string and never throws: a file it cannot store comes back as a `size-limit`,
  `frontmatter-syntax` or `comark-parse` violation (`tests/markdown/limits.test.ts`,
  `tests/markdown/frontmatter.test.ts`, `tests/markdown/fuzz.test.ts`).
- Comark and `@comark/html` are imported lazily, the first time a file is processed or rendered,
  so a Worker that only reads never loads them (`tests/markdown/lazy.test.ts`, which lists the
  files of the folder: a new module must be added there).
- `src/markdown/analyze.ts` is the one walk that judges a document and extracts its headings,
  links, images, components, words and `disallowed`; `src/markdown/policy.ts` holds the tags, the
  attributes each tag may carry and the URL schemes. Nothing Comark cannot represent is dropped
  silently: raw HTML, unknown components, attributes outside the allowlist, unsafe URLs, braces in
  prose and text after the parameters of a component's opening line each leave a marker or a
  `disallowed` entry. `renderHtml` sanitizes any document before `@comark/html` prints it.
- A change that gives some Markdown another document bumps `PIPELINE_VERSION` and re-pins the
  output of the shared fixtures; `COMARK_VERSION` is bound to the installed package. A Comark
  upgrade re-runs the hostile and braces tests: the parser turns off the markdown-it rule
  `comark_block_yaml` (an alias bomb in a component's YAML props took tens of seconds) and wraps
  `comark_inline_props` by name.
- Tests that process Markdown call `warmUpComark()` from `tests/markdown/support.ts`: the first
  import of Comark in workerd takes seconds. `vp run bench` fails when the p95 CPU time of a
  write of the 2,027-word fixture is over 3 ms.
