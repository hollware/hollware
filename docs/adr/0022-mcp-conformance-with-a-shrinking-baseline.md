# ADR-022: MCP conformance runs in CI against a baseline that only shrinks and never covers what Hollware claims

Status: Proposed (2026-10-12)

## Context

Hollware serves two revisions of the MCP specification, 2026-07-28 and 2025-11-25 ([ADR-012](0012-official-mcp-sdk-v2.md)). The official suite, `@modelcontextprotocol/conformance` 0.2.0-alpha.12, checks a server against one revision (`conformance server --url <url> --requirements <revision>`) and accepts a file of expected failures (`--expected-failures`).

Spike S8 ran the suite against a stub Worker:

- The 2026 revision reported 99 passing and 70 failing checks, with 5 of 37 required scenarios clean. The 2025 revision reported 35 and 26.
- Every failure was a capability the stub did not offer (resources, prompts, completion, logging) or a `test_*` fixture tool the suite expects. None was a wire-format error.
- The baselines held 32 and 26 entries. In baseline mode a warning counts as a failure.
- The suite cannot send credentials, and Hollware's MCP endpoint requires a personal token ([ADR-019](0019-personal-tokens-in-v0-1-oauth-with-the-admin.md)).
- Under `vp dev`, Vite's host check answers before the Worker does, so a missing DNS-rebinding guard goes unnoticed.

A file of expected failures can make any regression pass, and nothing stops it from growing (review H4).

## Decision

- CI runs the suite for both revisions (the task `test:conformance`) against `wrangler dev` of the built playground. A proxy in `tests/conformance` adds a personal token and passes the `Host` and `Origin` headers through unchanged.
- Each revision has one baseline file. Every entry names one check and carries a class and a reason. The classes are:
  - `not-offered`: a capability Hollware does not offer in this version, such as resources, prompts, completion or logging;
  - `fixture`: a `test_*` tool the suite expects, which is not part of the operation registry;
  - `upstream`: a defect of the suite, with a link to its issue.
- A must-pass profile lists the checks of what Hollware claims: the lifecycle and version negotiation, `tools/list` and `tools/call` with structured output and errors, the Streamable HTTP transport with its `Host` and `Origin` checks, and authorization (401 with the resource metadata, 403 with the missing scopes). No baseline entry may match the profile, and a guard fails if one does.
- The size of each baseline is recorded and only goes down, like the exception lists. An entry that starts passing is removed. Adding one is a reviewed change that states its class and reason.
- When the suite fails in CI, the job uploads its results.

## Consequences

- A regression in what Hollware claims fails CI, even when someone extends the baseline.
- Implementing a capability shrinks the baseline in the same change.
- Upgrading the suite, which is still an alpha, can add checks. The upgrade classifies its new failures, and a new check of something Hollware claims joins the profile.
- Building the playground and starting the proxy make the job slower than the unit tests, and it runs without the task cache.

## Alternatives considered

- No baseline, running only the scenarios that pass today. Rejected: new scenarios of the suite would go unnoticed, and a failure could not be told from an omission.
- A free-form file of expected failures. Rejected: it can hide anything and grows without review (review H4).
- Running the suite against `vp dev`. Rejected: Vite's host check hides a missing DNS-rebinding guard (spike S8).
