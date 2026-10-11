# ADR-012: Official MCP SDK v2; the Agents SDK only for Hollware's own agents

Status: Accepted (2026-10-11)

## Context

MCP is the primary interface, so the SDK underneath it matters. Two options exist on Workers: the official `@modelcontextprotocol/server` v2, and the MCP wrapper in Cloudflare's Agents SDK. The wrapper pins `@modelcontextprotocol/server` at exactly 2.0.0, which would lose everything that came later: Tasks from the 2026 specification, OAuth scopes per tool, audience validation (`expectedResource`), input limits, fixes for Workers and CPU improvements.

The 2026-07-28 specification is stateless: there are no sessions, and there is a `server/discover` method. That fits a Worker that creates a server for every request.

## Decision

Use the official SDK, `@modelcontextprotocol/server` 2.3.x.

- `createMcpHandler(buildServer)` builds a new server on every request and is mounted on a Hono route through its `.fetch`. `@modelcontextprotocol/hono` is not used, because it requires Hono 4.
- Tools are generated from the operation registry (see [ADR-003](0003-one-operation-registry-three-surfaces.md)). The validator is `validators/cf-worker`, which avoids `eval`.
- The compatibility mode for 2025 clients is on. Long operations use the Tasks extension backed by Workflows, and confirmations use multi round-trip requests (MRTR). `tools/list` is deterministic and carries a `ttlMs`. Roots, Sampling and Logging are not used, because they are deprecated.
- `@modelcontextprotocol/conformance` runs in CI.
- The Agents SDK is used only for Hollware's own agents, in the intelligence phase (v0.5): each one lives in its own Worker, connected by service binding.

## Consequences

- Hollware stays current with the MCP specification. Tasks, scopes per tool and audience validation arrive with the SDK, not with the release schedule of a wrapper.
- Conformance is verified on every change, so a regression against either specification era fails CI.
- The SDK moves quickly. Its version is exact in the catalog, and a spike in v0.1 measures the CPU cost of creating a server per request and of converting Zod to JSON Schema. If that is too costly, schemas are precomputed and registered with `fromJsonSchema`.
- Two SDK lines coexist in the repository, one for the MCP server and one for the agents, and living in separate Workers is what prevents a version clash. The agents package pins `agents` at 0.28.0 in isolation, because that version pins the MCP SDK at 2.0.0.
- Own agents get a principal with `content:read` and `content:write` and never `content:publish`.

## Alternatives considered

- The MCP wrapper of the Agents SDK, which was the first candidate because it is Cloudflare's own. Rejected: it pins the MCP SDK at 2.0.0, so Hollware would lose the 2026 Tasks, the scopes per tool, audience validation and the fixes for Workers.
- `@modelcontextprotocol/hono`. Rejected: it requires Hono 4, and Hollware uses Hono 5.
- The Agents SDK for everything. Rejected for the MCP server, for the reasons above. It is kept for stateful agents, where it is the right tool.
