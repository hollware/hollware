# ADR-018: `core` type-checks against the web platform and runs its tests in Node and workerd

Status: Accepted (2026-10-12)

## Context

`@hollware/core` promises to run anywhere: in the Worker, in the Node CLI and, from v0.3, in the browser that runs the admin, where the contracts validate forms and Comark renders the preview. Until now nothing held that promise beyond imports. `core` type-checked with Node's types and ran its tests only in Node, and the guard `core-purity` knew five Node globals by name, so `setImmediate`, `global` or a browser global would have passed every check.

Dropping `"types": ["node"]` from `core`'s `tsconfig.json` does not help by itself. The same program includes the tests and `vite.config.ts`, which import Vite+, and Vite+ brings Node's types in through its own declarations. Measured on 2026-10-12: with `types: []` in that program, `setImmediate` and `localStorage` still type-checked in `src`.

## Decision

- `packages/core/tsconfig.json` covers only `src`, with `lib: ["es2024", "webworker"]` and `types: []`. The web APIs `core` needs (`TextEncoder`, `URL`, `crypto.subtle`, `structuredClone`, `fetch`) type-check; Node globals (`setImmediate`, `global`, `process`) and DOM globals (`document`, `window`, `localStorage`) are type errors in `vp check`.
- The tests and the configs of `core` type-check through `packages/core/tests/tsconfig.json`, which has Node's types.
- Every test of `core` runs twice: in Node (the package's own project) and inside workerd (`core:workerd`, `packages/core/vitest.workerd.config.ts`, with no Worker of its own).
- The guard `core-purity` checks the three facts: the `tsconfig` of `src`, its `include`, and that every test file of `packages/core/tests` runs in both projects.

## Consequences

- A Node or browser global in `core` fails `vp check`, whatever its name. The import rules of `core-purity` still catch `node:*` and Cloudflare modules.
- The run in workerd proves that `core` works in that runtime, not that it works without Node: `@cloudflare/vitest-plugin` keeps Node.js compatibility on in its test runner whatever the flags say. "No Node" is kept by the types.
- `webworker` is a little wider than the APIs every runtime shares (it declares `importScripts` and `postMessage`, for example). The run in workerd catches what workerd lacks. When the admin starts using `core` in v0.3, a browser run can join the two.
- Changing the type environment of `core` means changing this ADR and the guard together.

## Alternatives considered

- Keep Node's types and narrow the promise to "runs in Node and Workers". Rejected: the admin needs `core` in the browser in v0.3, so the promise would have to come back.
- A hand-written declaration of exactly the globals `core` uses. Stricter, but every new web API would need a declaration kept by hand, for little gain over `webworker` plus the run in workerd.
