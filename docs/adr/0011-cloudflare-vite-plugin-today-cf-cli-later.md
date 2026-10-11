# ADR-011: Cloudflare's Vite plugin today, the `cf` CLI later

Status: Accepted (2026-10-11)

## Context

Hollware has to run, build, test and deploy Workers from inside Vite+. Cloudflare is moving its tooling to a new `cf` CLI, configured with `cloudflare.config.ts`. That CLI has been in beta since 2026-09-28, and `cf dev` currently fails in Vite+ projects (workers-sdk#16150). Wrangler will be maintained for 18 months after the beta ends.

The Cloudflare Vite plugin 1.x, in contrast, is stable today and uses the same pipeline as the `cf` CLI.

## Decision

Use `@cloudflare/vite-plugin` 1.x inside Vite+: `vp dev` runs the admin and the API together with hot module replacement, and `vp build` builds the Worker. Configuration stays in `wrangler.jsonc`, deployment uses `wrangler deploy`, and `wrangler types` generates the types in place of `@cloudflare/workers-types`.

Tests run `core` with Vitest in Node and `server` with `@cloudflare/vitest-plugin` in workerd, always through the project-local `vp`.

Hollware migrates to `cf` and `cloudflare.config.ts`, with `cf migrate`, when `cf` leaves beta and workers-sdk#16150 is closed. Until then, two upstream issues are watched: vite-plus#2481 and a pending Vitest 5 bug (workers-sdk#15618).

## Consequences

- One dev loop for the admin and the API, on a plugin that is stable.
- A planned migration to `cf` once it is stable, done with `cf migrate`.
- The plugin breaks when a global `vp` of a different version is used (vite-plus#1076), so every script and every instruction uses the project-local binary, through `pnpm exec` or package scripts.
- A Worker's compatibility date must not be newer than the workerd bundled with the plugin, so the walking skeleton pins a date no later than 2026-10-06.
- Exact versions are pinned in the catalog: the plugin at 1.63, Wrangler at 4.149 and `@cloudflare/vitest-plugin` at 1.4.

## Alternatives considered

- Adopt the `cf` CLI now. Rejected: it is in beta and fails in Vite+ projects today.
- Wrangler alone, without the Vite plugin. Rejected: `vp dev` could no longer serve the admin and the API together with hot reload, and the build would not share the Vite+ pipeline.
