# ADR-002: D1 is the single source of truth

Status: Accepted (2026-10-11)

## Context

Hollware needs one data model for writing and for reading. People and agents can edit the same entry at the same time, so a concurrent edit must be detected and reported, never silently overwritten. Revisions must never be edited. Sites read from all over the world.

An earlier draft of the design kept one Durable Object per entry as the writer, with D1 as a read model. D1 now has read replicas and a Sessions API that guarantees a session reads what it wrote, and together they cover global reads without a second store.

## Decision

D1 is the single source of truth for entries, append-only revisions, users, passkeys and personal tokens. OAuth state is the one exception: workers-oauth-provider keeps it in KV (see [ADR-005](0005-cloudflare-oauth-provider-passkeys-and-personal-tokens.md)).

- Concurrency is optimistic. `entries.version` increments on every mutation. A write is one `db.batch`: an `INSERT INTO revisions … SELECT … WHERE version = ?` followed by an `UPDATE entries … WHERE version = ? RETURNING version`. An empty `RETURNING` means someone else changed the entry, and the agent receives an explicit conflict to retry on top of the new version.
- Revisions are only ever appended.
- Markdown lives in the row, which D1 limits to 2 MB. Binaries live in R2.
- Reads use D1 read replicas through the Sessions API. MCP reads from the primary. The RPC adapter reads through `withSession('first-unconstrained')`, so a session always sees its own writes.
- Access goes through Drizzle 0.45, using the query builder and `sql` and not the relational API, so that moving to Drizzle v1 (in release candidate since April 2026) stays easy. Migrations are generated with drizzle-kit, applied with wrangler, and applied in user projects with `hollware migrate`.
- Durable Objects are reserved for real coordination: presence, locks and rate limits. Scheduled publishing is a Workflow.

## Consequences

- One data model and one place to back up. The conflict is part of an operation's output, not an exception, so an agent can handle it.
- A write is atomic: the revision and the entry move together or not at all.
- Reads scale through replicas and see their own writes within a session. A read outside a session can lag behind a write.
- Limits come from D1: a row is capped at 2 MB, a database at 500 MB on the Free plan (5 GB per account), and a Worker invocation can run 50 queries on the Free plan.
- Every table carries `site_id`, so one database can hold several sites (see [ADR-006](0006-one-deployment-per-account-several-sites-inside.md)).
- Moving from Drizzle 0.45 to v1 is a planned migration once v1 is generally available.

## Alternatives considered

- One Durable Object per entry as the writer, with D1 only as a read model. Rejected: every write happens twice, the read model lags behind the writer, and it adds moving parts. Durable Objects remain available for real coordination.
- Last-write-wins updates. Rejected: with people and agents editing concurrently, one of the edits would be lost without anyone noticing.
- Drizzle's relational API. Avoided so that the code stays easy to move to Drizzle v1.
