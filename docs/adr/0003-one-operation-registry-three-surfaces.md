# ADR-003: One operation registry, three surfaces (RPC, HTTP + OpenAPI 3.1, MCP)

Status: Accepted (2026-10-11)

## Context

Hollware has to be reachable in three ways: agents over MCP, sites on Cloudflare over a service binding, and everything else (the admin, sites outside Cloudflare, apps and scripts) over HTTP. If each surface defined its own operations, their schemas and permissions would drift apart.

For a site in the same Cloudflare account, a service binding with Workers RPC is typed, does not cross the public network and needs no token. No traditional headless CMS can offer that. Everything that does not live on Cloudflare needs a standard door with reads that can be cached.

## Decision

Every operation is defined once, in a registry: its name, the Zod schemas of its input and output, the scopes it requires and its handler. Adapters expose the registry on three surfaces. The specs live in `@hollware/core`, and the handlers and adapters in `@hollware/server` ([ADR-017](0017-operation-specs-in-core-handlers-in-server.md)).

- Native Workers RPC, through a `WorkerEntrypoint`, for sites in the same Cloudflare account. It is the main read path, and in v0.1 it exposes reads only.
- HTTP with an OpenAPI 3.1 document generated from the registry (Zod to JSON Schema), without `@hono/zod-openapi`. Reads are `GET` requests that can be cached with `Cache-Control` and `ETag`.
- MCP tools, generated from the same registry (see [ADR-012](0012-official-mcp-sdk-v2.md)).

The router is Hono 5, starting at the release candidate published on 2026-10-10 with an exact version. If that candidate fails, the fallback is Hono 4.13. `@hollware/client` offers the same typed interface over a service binding or over HTTP.

## Consequences

- The MCP, RPC and HTTP contracts cannot drift apart, because all three come from the same definitions. The OpenAPI document is a build output that lists each operation exactly once.
- A site on Cloudflare reads over RPC with types, no public network and no token. Everything else, including the admin and sites outside Cloudflare, uses HTTP with cacheable reads.
- Operation outputs are flat objects such as `{ outcome, entry?, verdict?, conflict? }`, because MCP requires an object at the root of a tool result.
- Hono 5 is a release candidate. Everything that depends on its version is isolated in one file, `http/errors.ts`, so falling back to Hono 4.13.13 touches a single file.
- `@hollware/client` has to behave identically over the binding and over HTTP, so one test suite runs against both transports.

## Alternatives considered

- `@hono/zod-openapi`. Rejected: it makes the Hono routes the source of the schemas, while the registry is meant to be the only definition.
- Separate handlers and schemas for each surface. Rejected: the three contracts would drift.
- Cap'n Web as the RPC layer. Kept under observation (version 0.12): it has no HTTP caching.
- Hono 4.13 from the start. Kept as the fallback if the Hono 5 release candidate proves unusable.
