# ADR-024: Entries that link to each other are published together, in one step

Status: Accepted (2026-10-14)

## Context

The contract `internal-links-resolve` runs at publish and asks that every internal link point at a published entry. Entries that link to each other cannot meet that one at a time: in v0.1, two drafts that link to each other never publish when the contract is an error, because each waits for the other. As a warning it does not deadlock, but every publish asks for an acknowledgement whose fix names another entry of the cycle, and `hollware import --publish`, which acknowledges nothing, published none of the ten entries of the playground's corpus, whose links form a cycle.

Both readings of the rule are worth keeping. A link to an entry that does not exist is a mistake. A link to an entry that is about to be published with this one is not.

## Decision

- `publish` takes one entry or a group of entries of one site, each with the version it was read at. The contracts of the publish phase run on every entry of the group as if the whole group were published, so a link to another member resolves. The group is published in one D1 batch, all or none: one conflict, one error or one unacknowledged warning publishes nothing, and the answer names the member and the problem.
- An acknowledgement names a contract and a path, and it holds for every member of the group that reports that warning.
- Later, `internal-links-resolve` may report a link to an entry that does not exist as an error at write and at publish, apart from a link to an entry that exists but is not published. It is not part of this decision.
- `hollware import --publish` publishes everything it imported as one group, in groups of at most 100 entries, the limit of a `list_entries` page.
- It lands in v0.2. The playground keeps the contract as a warning.

## Consequences

- A set of entries that link to each other goes live together, so a site never serves a link to an entry that is still a draft.
- The batch size bounds a group: the number of statements of one D1 batch and the CPU of running the contracts on every member. A group larger than the limit is refused with a fix that says to split it.
- Agents get one more input shape for `publish`, and MRTR asks one question for the warnings of the whole group.

## Alternatives considered

- Make `internal-links-resolve` a warning by default. Rejected: it removes the deadlock but not the friction, and a link that can never resolve stops being an error.
- Count a link to a draft as resolved. Rejected: the site would serve links to pages that do not exist yet.
- Let the CLI publish in dependency order and acknowledge the link warnings that point inside the import. Rejected: a cycle has no order, and between two publishes the site serves a broken link.
- Check links on the site at render time, and drop or mark a link to an unpublished entry. Rejected for the core: every site would need its own rule. A site can still do it.
