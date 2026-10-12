# ADR-017: Operation specs live in `core`; handlers and adapters in `server`

Status: Accepted (2026-10-12)

## Context

[ADR-003](0003-one-operation-registry-three-surfaces.md) defines every operation once, in a registry, and exposes it over MCP, Workers RPC and HTTP. It does not say which package holds that definition. The design, the README and the package descriptions put the whole registry in `@hollware/server`, while the v0.1 plan put the specs in `@hollware/core` and the handlers in `server`. The F0 review asked for one answer.

The specs are needed outside the Worker. `@hollware/client` (v0.2) offers the same typed interface over a service binding or over HTTP, `@hollware/admin` (v0.3) calls the operations through it, a site on Cloudflare types its binding with them, and the CLI calls the MCP tools by name. If the specs lived in `server`, every one of them would install the Worker's dependencies (Hono, the MCP SDK, Drizzle, the OAuth provider) just to get the types. `core` already runs anywhere, has no Cloudflare dependency, and is used inside the workspace without a build ([ADR-016](0016-workspace-packages-resolve-to-source.md)).

## Decision

An operation is specified once, in `@hollware/core`, and implemented once, in `@hollware/server`.

- A spec in `core` declares the operation's name, the Zod schemas of its input and output, the scopes it requires, and its effect: `read`, `edit`, `write` or `destructive`. Outputs stay flat objects with an `outcome` field, as ADR-003 says. A spec holds no handler, no MCP or HTTP vocabulary and no Cloudflare type.
- `server` holds one handler per spec and the adapters that expose them. Each adapter derives its protocol details from the spec: the MCP tools and their annotations, the HTTP routes with their methods, cache headers and OpenAPI document, and the RPC methods. The effect decides the MCP read-only and destructive hints, and only a `read` can be a cacheable HTTP `GET`.
- The registry is the pairing of every spec with its handler, assembled in `server`. The pairing is typed: a spec without a handler, or a handler for an unknown spec, is a type error.

## Consequences

- The client, the admin, sites and the CLI import the specs from `core` without installing the Worker, and the types of an operation come from one place.
- `core` depends on zod at runtime. zod runs anywhere, `server` already ships it through the MCP SDK, and the workspace keeps a single copy.
- `core` stays free of protocols: a new surface, or a new revision of MCP, changes an adapter in `server` and leaves the specs alone.
- ADR-003's "defined once" now reads "specified once in `core`, implemented once in `server`". The design, the README and the package descriptions say so.

## Alternatives considered

- The whole registry in `server`, as the documents said. Rejected: the client, the admin and sites would depend on the Worker package for its types, or would copy them.
- A new published package, `@hollware/api`, for the specs. Rejected for now: a seventh published package needs its own npm reservation, trusted publisher and release setup, for no gain over `core`.
