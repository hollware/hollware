# ADR-009: Cloudflare only until v1

Status: Accepted (2026-10-14)

## Context

Hollware's value comes from what Cloudflare offers as primitives: Workers RPC over service bindings, D1 with read replicas, Workflows, Queues, R2, Vectorize, and a free tier that keeps two sites near zero cost (principle P5). Supporting other runtimes or clouds would mean abstracting each of those primitives, and the abstraction would hide the very features that make the design work.

## Decision

Until v1.0, Hollware runs only on Cloudflare. Every piece uses the native primitive, with no abstraction layer for other providers, and portability is not a goal.

`@hollware/core` does not depend on Cloudflare, so it can be tested in Node. That is a property of the test setup, not a promise of portability. If portability becomes a goal after v1.0, only storage would be abstracted.

## Consequences

- Faster delivery and a smaller surface to test: there is no adapter matrix and no lowest-common-denominator feature set.
- Lock-in to Cloudflare is accepted. Running outside Cloudflare is a non-goal before v1.0.
- Consumers are not locked in: a site outside Cloudflare reads through the HTTP API, which is described by OpenAPI 3.1 (see [ADR-003](0003-one-operation-registry-three-surfaces.md)).
- Keeping `core` free of Cloudflare imports costs nothing today and keeps the option open for later.
- This ADR is proposed. It is confirmed when the code that depends on it starts, in v0.1, and it is revisited after v1.0.

## Alternatives considered

- Provider-neutral interfaces for storage, queues and workflows from the start. Rejected for now: the abstraction costs time before there is a second target, and it would hide D1 read replicas, Workflows and RPC over service bindings.
- A Node or container target next to Workers. Rejected for now: it needs a different storage and concurrency story, and it doubles the test matrix.
