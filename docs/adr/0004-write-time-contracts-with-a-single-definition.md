# ADR-004: Write-time contracts with a single definition

Status: Accepted (2026-10-11)

## Context

Quality rules for content usually run in a CI pipeline, minutes after the content was written. For an agent that is the wrong place: the feedback arrives late, away from the edit, and in a form meant for a human reading logs.

Hollware's third principle is to validate at write time: the error returns to the agent in milliseconds, with an instruction to fix it. The same rules have to apply whether the write comes from MCP, the admin or the HTTP API.

## Decision

A contract is a rule with a name, a severity and a fix instruction. Each violation carries the contract id, the severity, a JSON Pointer to the offending field, a message and a `fix`. The same definition runs on every surface, on every write.

- A collection declares its frontmatter schema, the components allowed in the body with their props, and a list of contracts. Zod 4 is the default, and any Standard Schema that also implements Standard JSON Schema (`~standard.jsonSchema`) works, as it does in `@modelcontextprotocol/server` 2.x.
- Rules between entries, such as unique slugs and references, are added by Hollware on top of the schema. Built-in contracts cover complete translation pairs, internal links that resolve and images with alt text.
- Errors block `publish` but never block saving a draft. Warnings are accepted when publishing, as long as they are acknowledged and recorded.
- `publish` runs the contracts again, in the `publish` phase.
- The verdict is stored with the revision, so what a published entry passed can be audited later.

## Consequences

- An agent can save a half-finished draft and keep fixing it without human intervention: a contract is feedback, not a barrier.
- One schema produces the JSON Schema that agents see over MCP and validates the admin's forms, so the three surfaces cannot disagree about what is valid.
- Zod 4 is in the Worker bundle anyway, through the MCP SDK v2. Because contracts accept any Standard Schema with JSON Schema, a team can bring another validation library.
- Every revision stores its verdict. That makes the contracts an entry passed at publication auditable, at the cost of storing a result per revision.
- Publishing is the only gate that can fail on contracts, so a draft can exist in a state that would never publish. The verdict says what is wrong and how to fix it.
- Contracts run inside the Worker on every write and count against its CPU budget, so they are written to stay cheap. A Comark parse of 2,000 words takes 0.6 ms.

## Alternatives considered

- Validating in a CI pipeline, as Nuxt Content does at build time. Rejected: the feedback arrives minutes late and away from the edit, in a form an agent cannot act on.
- Blocking invalid drafts as well as invalid publications. Rejected: it stops an agent from saving work in progress.
- A contract API tied to Zod alone. Rejected: Standard Schema lets users keep the validation library they already use.
