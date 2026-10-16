# ADR-036: What 1.0 promises, and how the repository keeps it

Status: Proposed (2026-10-16)

## Context

Until now every minor version of Hollware could change anything: 0.x makes no promise, and the
releases from 0.1.0 to 0.9.1 renamed fields, added required ones and moved the structure of the
sites into D1. A 1.0 is a promise that an agent, a site or a script written against it keeps
working through every 1.x. The promise is only worth what holds it: a list of what it covers, and
a check that fails when a change breaks it.

What people build on is spread over seven surfaces. An agent calls the MCP tools; a site reads
over the RPC entrypoint, the read API at `/v1`, or `@hollware/client` and `@hollware/nuxt`; a
receiver gets the events of webhooks; an operator runs the CLI; a project imports the packages;
and a database holds the migrations already applied.

## Decision

**Semver covers the public API, and only it.** From 1.0.0 a minor or patch version keeps every
one of these working as it did; a change that breaks one is a major version:

1. **MCP tools**: their names, the scopes each asks for, their input and output schemas, and the
   shape of an error.
2. **The read API** at `/v1`: its paths, parameters and responses, as its OpenAPI document says.
3. **The RPC entrypoint** `Hollware`: its methods and their signatures.
4. **The events of webhooks**: their kinds and fields, and how they are signed.
5. **The CLI** `hollware`: its commands and flags.
6. **The exports** of every published package: each name, value or type.
7. **The migrations** that a release shipped: never changed or removed, only followed by new ones.

**What fits a minor version:** a new tool, path, method, command, flag, export or event kind; a new
optional input; a new field in an answer or an event; a new value of an `outcome` or of an event's
`kind`. A client handles an outcome or a kind it does not know as the docs of each say (an outcome
it does not know is an answer it does not act on; a kind it does not know is skipped).

**What is not covered:** the admin's screens and its routes under `/v1/admin`, which only the admin
calls; the text of messages, fixes and descriptions; logs; the playground, the examples and
hollware.com; anything a package does not export.

**How the repository keeps it:**

- `api/` holds the public API as the code makes it (`scripts/api.ts`): the tools with their scopes
  and schemas, the OpenAPI document, the RPC signatures, the JSON Schema of the events (now a
  schema of `@hollware/core`, `hollwareEvent`, which the server builds its events with), the
  commands and flags, the exports, and the hash of every migration. The guard `public-api` fails
  when the code and `api/` differ, so every change of the public API is in the diff of the change
  that makes it, and a reviewer sees it.
- `scripts/api-check.ts --against <ref>` lists what breaks between `api/` at a ref and the code
  (`scripts/api-compat.ts`): an input that gets stricter, an answer that loses a field, anything
  that goes, a scope a tool starts to ask for, a migration that changed. From `1.0.0-rc.1` on, CI
  runs it against the last release, and a break fails unless the change set holds a major version.
- 1.0 comes through release candidates (`changeset pre enter rc`): `1.0.0-rc.N` on npm under the
  tag `rc`, the API of the first one compared with every later one.

## Consequences

- A tool, a field or a flag that is wrong after 1.0 stays until 2.0; it can be deprecated (said in
  its description and the docs) in a minor version and removed in the next major.
- The shape of the events is a schema of `@hollware/core` now, and receivers can parse a body with
  `parseHollwareEvent` instead of trusting it.
- `api/` changes with every new tool or field, and those diffs are large JSON; they are reviewed as
  the contract they are.
- What the CLI lists must be real by 1.0: its `export` command, still planned, is implemented or
  removed before `1.0.0-rc.1`.
- The compatibility check covers what the schemas say. A change of behavior behind an unchanged
  schema (an outcome given in another case, a default that moves) is caught by the tests of each
  operation, not by `api-check`.

## Alternatives considered

- `oasdiff` for the read API and api-extractor for the packages. Rejected for now: oasdiff covers
  one surface of seven and the npm package of that name is a security placeholder (it would come as
  a pinned binary or Action), and api-extractor does not support TypeScript 7 yet. One reader of the
  code and one checker keep the seven surfaces under the same rule.
- No `api/` in the repository, comparing the published packages instead. Rejected: a break would
  show only after the release that carries it, not in the change that makes it.
