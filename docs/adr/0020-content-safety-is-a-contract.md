# ADR-020: Content safety is a contract: raw HTML, unknown components and unsafe attributes are errors at write time

Status: Accepted (2026-10-12)

## Context

The v0.1 spike of Comark 0.7 showed that its defaults are unsafe for stored content:

- raw HTML (`<script>`, `onerror`) and component props pass through to the HTML;
- the component and attribute syntax can create any tag and any attribute;
- `autoClose`, meant for streaming, silently rewrites incomplete syntax and is quadratic on hostile input.

Comark's `security` plugin helps only in part. Its attribute rules are a blocklist. With `allowedTags`, it removes a disallowed node together with its children, so a misspelled `::youtub` component would vanish from the document while the contract that checks components never saw it.

Hollware's thesis is that an agent learns what it may write from errors that carry a fix, at the moment it writes ([ADR-004](0004-write-time-contracts-with-a-single-definition.md)).

## Decision

- The Markdown of an entry holds Markdown and the components its collection declares. Raw HTML, unknown components, attributes outside the allowlist and unsafe URLs are contract errors (`raw-html`, `unknown-component`, `disallowed-attribute`, `unsafe-url`), and each one carries a `fix`.
- These errors never block saving a draft (ADR-004). They block publishing, so published content never carries them.
- Native tags have an allowlist of attributes, for example `href` and `title` on links, `src`, `alt`, `title`, `width` and `height` on images, and only `language-*` classes on code. `class` and `style` exist only as props that a component declares, and component props are validated with strict schemas that reject unknown keys.
- Nothing is dropped silently. The parser replaces a disallowed node with a marker that the contracts report, and the stored Markdown is never changed. (Clarified on 2026-10-13: the markers come from Hollware's own walk of the document, not from Comark's `security` plugin and `tagFallback`, which remove attributes and whole blocks with nothing to report.)
- The pipeline parses with `autoClose: false`, without Comark's `html` plugin, and computes heading ids of its own that keep non-ASCII letters.
- The allowlist and the pipeline settings belong to `pipelineVersion`, which every derived document records.

## Consequences

- An agent finds out what it may write from the violations and from `describe_site`, and a typo in a component name is an error, not a missing paragraph.
- The HTML of a published entry contains no raw HTML.
- A site that renders the Markdown with its own pipeline, instead of the stored document, has to sanitize it itself; the documentation says so.
- Changing the allowlist changes `pipelineVersion`, so `reparse` (v0.2) can rebuild the documents written before.

## Alternatives considered

- Escape raw HTML and drop what is not allowed, silently. Rejected by the maintainer: the agent never learns, and content can disappear.
- Allow a subset of HTML. Rejected: a larger XSS surface and an allowlist of tags to maintain, for content that Markdown and components already cover.
