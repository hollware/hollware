# ADR-029: Full-text search in D1

Status: Accepted (2026-10-15)

## Context

v0.5 lets an agent find what is already written before it writes. Full-text search was planned for v0.2 and moved out; semantic search over Vectorize comes after it in this stage. Search has to stay true to what is published, across every way content gets published: a single entry, a group, a schedule that comes due, an unpublish.

## Decision

- **An FTS5 table in D1, `entries_fts`** (migration `0008_search.sql`, written by hand), with the title, the tags and the text of the published revision of each entry, and its id, site, collection and locale unindexed. The tokenizer is `unicode61 remove_diacritics 2`: "migracion" finds "migración".
- **The text comes from the stored Comark document**, the strings at the text positions of its nodes, so no Markdown mark, attribute or link target is indexed.
- **Triggers keep it**, on `entries.published_rev` and on the deletion of an entry, in the same step as the write that changes what is published, whichever write it is. The migration indexes what is published already. Only published content is in it.
- **The operation `search`** (MCP, `/v1/ops`, the read API at `GET /v1/search`, RPC and `@hollware/client`): every word of the query must match, ranked by bm25 with the title weighing 10, the tags 4 and the text 1, with a snippet that marks the match. What someone typed is reduced to its words, each quoted, so FTS5's own syntax is never read from it.

## Consequences

- Search costs nothing at write time beyond the trigger, and nothing at all for drafts.
- A collection cannot be named `search`: the read API's route takes the name.
- Semantic search (vectors, later in v0.5) is a second index beside this one; hybrid search merges the two.

## Alternatives considered

- Maintaining the index from each write of the store. Rejected: five paths publish or unpublish, and a trigger cannot be forgotten by a new one.
- Indexing the Markdown as it is. Rejected: its marks and link targets would match, and snippets would show them.
