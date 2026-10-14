# ADR-025: Publishing commits in one batch, and its effects go through an outbox

Status: Accepted (2026-10-14)

## Context

The design made publishing a Workflow that validates, commits, purges and records `liveAt`, tracked by the agent as an MCP Task. The MCP SDK 2.3.1 ships the types of Tasks and nothing that stores or serves them, and in the 2026-07-28 revision Tasks are an extension that clients may not support, so Hollware would build and maintain `tasks/get`, `tasks/list` and `tasks/cancel` on D1 for clients that may never call them. Meanwhile the commit is already atomic and instant: one D1 batch. What can fail or take time are the effects of a publication: purging caches, calling webhooks, notifying IndexNow.

## Decision

- `publish` stays a synchronous operation. It commits the publication, of one entry or of a group (ADR-024), in one D1 batch, and in the same batch writes one outbox row per effect.
- A Queue consumer delivers the outbox: it purges the cache tags of what changed, calls the webhooks and notifies IndexNow, with retries, a dead-letter queue and idempotent deliveries keyed by the outbox row. A cron sweep requeues rows that were never sent.
- A scheduled publication is an entry in status `scheduled` with its `scheduled_at`; a cron trigger every minute publishes the ones that are due, through the same code as `publish`.
- Workflows, and MCP Tasks to follow them, come with v0.3, where publishing waits for a person's approval (`waitForEvent`).

## Consequences

- An agent gets `published` as soon as the batch commits; the site shows the change once the consumer has purged the cache, in seconds.
- An effect that fails is retried and lands in the dead-letter queue, never lost: the outbox row is written with the publication or not at all.
- A scheduled publication can be up to a minute late.
- Publishing needs a Queue binding and a cron trigger in a project's `wrangler.jsonc`, both within the Free plan.

## Alternatives considered

- A Workflow per publication, tracked as an MCP Task (the original design). Deferred to v0.3: it costs the Tasks extension on our side for clients that may not use it, and the commit gains nothing from it.
- Running the effects inside the request with `waitUntil`. Rejected: an effect that fails after the answer is lost, with no retry.
- A Workflow with `sleepUntil` per scheduled publication. Rejected for now: a cron sweep is simpler and good to the minute.
