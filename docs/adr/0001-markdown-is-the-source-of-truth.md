# ADR-001: Markdown is the source of truth; the Comark document is derived

Status: Accepted (2026-10-11)

## Context

Agents are Hollware's primary editors, and Markdown is what they read and write best. It also produces readable diffs between revisions, and moving existing content into Hollware is mostly a matter of copying files.

Sites, on the other hand, need something they can render without parsing it on every request. Comark compiles Markdown to a compact JSON document, with components compatible with MDC. Renderers for Vue, React, Svelte and Angular draw that document directly, and `@comark/html` renders it to HTML.

Parsing has to be cheap: the Workers Free plan gives 10 ms of CPU per request. Measured on Node 24 with a 2,027-word post, Comark takes 0.56 ms to build the AST and 0.71 ms to produce HTML, and 1.8 ms for 10,000 words. remark takes 3.5 ms for the same post and 18.5 ms for 10,000 words.

Comark is pre-1.0 (version 0.7), so its API and the shape of its document can still change.

## Decision

Markdown is the source of truth. Every revision stores the complete file, frontmatter and body, in `revisions.markdown`, so an export is byte-identical to what was written.

A write parses the Markdown once with Comark. The parse validates the document, extracts the headings, links, images, components and word count, and produces the compact JSON document. That document is derived data: it is stored next to the `comark_version` that produced it.

Derived data can be regenerated at any moment with `hollware reparse`, because everything in it can be rebuilt from the Markdown. On read, a site asks for the Markdown, the Comark document or HTML, whichever it renders best.

Comark is pinned to an exact version in the pnpm catalog.

## Consequences

- Upgrading Comark means regenerating documents. Every revision records `comark_version`, and `hollware reparse` rebuilds the derived columns (`document`, `comark_version`, `pipeline_version` and `word_count`) while the Markdown stays untouched.
- Revisions are readable diffs, and an export to plain Markdown files loses nothing.
- Content that does not parse is rejected at write time, so every stored revision has a derived document.
- Contracts can check body components and their props, because Comark parses the MDC syntax (see [ADR-004](0004-write-time-contracts-with-a-single-definition.md)).
- A site with a Comark renderer for its framework draws the document without shipping a parser to the browser.
- Comark's pre-1.0 status is a standing risk. The exact pin, `comark_version` and `reparse` are what keep it manageable.
- Markdown lives in the database row, and D1 caps a row at 2 MB. A revision over 1.9 MB is rejected with a `size-limit` violation, and binaries go to R2.

## Alternatives considered

- Portable Text, used by Sanity and EmDash, or another rich-text JSON such as Lexical (Payload), as the stored format. Rejected: it forces the agent to build JSON instead of writing prose, and it makes revisions unreadable.
- A remark and unified pipeline. Rejected on CPU cost: 3.5 ms for a 2,027-word post and 18.5 ms for 10,000 words, against a budget of 10 ms per request on the Free plan.
- Storing only the derived JSON document. Rejected: Markdown must remain the source so exports are lossless and the document can be rebuilt after a Comark upgrade.
