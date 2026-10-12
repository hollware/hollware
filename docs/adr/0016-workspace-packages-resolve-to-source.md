# ADR-016: Workspace packages resolve to their source; `dist` only in the published manifest

Status: Accepted (2026-10-12)

## Context

Every package of the workspace resolved only to its build: `exports` and `bin` pointed at `dist/`, which is not committed. Nothing imported another workspace package yet, so nothing broke. The F0 review reproduced what happens once something does, and v0.1 has `server` import `core` from its first wave. On a clean checkout the first such import fails three times: in the type check (`TS2307`), in the tests that run in Node and in the tests that run in workerd. With `dist/` present, a change to `core` stays invisible to `server` until someone rebuilds, under `vp dev` too. And `check:push` runs the type check and the tests before the build.

Vite+ 1.1 builds packages with tsdown 0.23, which has an option for this case: `exports.devExports`.

## Decision

Inside the workspace every package resolves to its source. Only the published manifest points at the build.

- Every package builds with `pack.exports.devExports: true`. `vp pack` writes `exports` (and `bin`) pointing at `./src/index.ts`, and `publishConfig.exports` (and `publishConfig.bin`) pointing at `dist/`. The published `"."` entry lists `types` before `default`.
- `pnpm pack` moves `publishConfig.exports` and `publishConfig.bin` into `exports` and `bin`, so a tarball holds the same manifest as before. The release packs with pnpm, because `changeset pack` runs `pnpm pack` in a pnpm workspace. The `publish` job refuses a tarball whose `publishConfig` holds anything besides `access` and `provenance`, which is what an `npm pack` of this manifest would leave behind.
- A clean checkout type-checks and tests without building anything. `check:push` runs `vp check` and `vp test` before any build, so CI proves it on every push.

## Consequences

- `vp check`, `vp test` and `vp dev` work right after `pnpm install`. Under `vp dev` a change to `core` reaches a running Worker through HMR, and a type error in a package fails the type check of the packages that import it.
- The manifest in the repository is not the one that gets published. `publint --strict` packs with pnpm before it lints, so it checks the published one, and the guard `manifests` pins both shapes.
- A package that imports another one type-checks that package's source, not its declarations, under the importer's compiler options. Every package extends `tsconfig.base.json`, so the options agree.
- Inside the workspace a bin runs from its source through Node's type stripping, so the source stays erasable TypeScript (`erasableSyntaxOnly` in `tsconfig.base.json` already requires it) and imports with `.ts` specifiers. `scripts/check-bins.ts` runs the published bin (`publishConfig.bin`), never the source one.
- Rebuilding a package rewrites its `package.json` with the same bytes.
- Three things keep the decision working: every package builds with `devExports: true` (guard `manifests`), the release packs with pnpm (the tarball check of the `publish` job), and `check:push` tests before it builds (guard `build-order`).

## Alternatives considered

- Build first: keep `dist/` as the only entry and make every task depend on `vp run -r build`. Rejected: `vp dev` would need one watcher per package, and a stale `dist/` stays possible.
- A custom export condition (`devExports: "@hollware/source"`). It works too, but every tool has to learn the condition: TypeScript through `customConditions`, and each Vite environment (Node, workerd and the Cloudflare plugin) through its own conditions. The published manifest would also keep an entry that points at a file the package does not ship.
- TypeScript `paths` and Vite aliases. Rejected: a second resolution map to keep in step with `exports`, and tools that resolve packages through their manifests ignore it.
