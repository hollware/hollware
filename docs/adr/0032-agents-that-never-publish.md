# ADR-032: Agents that never publish

Status: Accepted (2026-10-15)

## Context

v0.6 brings agents of Hollware's own: an editorial reviewer, an ES↔EN translator and a weekly auditor. They write; a person decides what readers see. The guarantee has to hold even when the token they are given is too strong, and they must cost nothing to run on the free plan unless the user picks a paid model.

## Decision

- **A plain Worker with cron triggers**, made by `createHollwareAgents(options)` of `@hollware/agents`, next to the user's Hollware. Every trigger runs the reviewer, then the translator; the audit runs on its own cron (Mondays 09:00 UTC by default). What they remember (the day's model calls, the translations they tried, the reviews they read) is in a KV namespace. The Agents SDK was tried and dropped: its required peer, the MCP SDK 1.x, brings a second hono; its entry needs Node.js compatibility; and it brings esbuild, Babel and a second MCP SDK for a schedule and a little memory.
- **Hollware is reached as any agent reaches it, over MCP**, with a personal token of `content:read` and `content:write`, through a service binding (no network) or over HTTP. Their client (`allowOnly`) refuses every tool outside an allowlist before any request: `publish`, `approve_review`, `request_changes` and `unpublish` are never called, whatever the token holds.
- **Two operations for them, useful to anyone:** `comment_review` adds a comment to a pending review (shown in the admin with the client's name), and `request_review` asks for a review after the same checks as `publish` and never publishes, whatever the caller's scopes.
- **The model is a port.** Workers AI by default (`@cf/meta/llama-3.3-70b-instruct-fp8-fast`), any id of it, an AI Gateway in front, or a function of the user's own for another provider. A daily cap (100 calls by default) stops the run when it is reached.
- **The roles:** the reviewer comments once on each pending review, on what the contracts cannot see; a comment of the agents on the review is how it knows it has read it. The translator drafts the missing translation of a published entry, fixes what the contracts refuse up to twice, and asks for its review, acknowledging the warnings that remain. The auditor needs no model: it reports the most read entries not updated in 180 days and the published entries the contracts refuse now, as a draft of a collection the user names (never published) and, optionally, to a webhook such as Slack's.

## Consequences

- Nothing the agents write reaches readers without a person: a translation is a pending review, a review gets a comment, an audit is a draft.
- The agents run in the user's account, at the user's cost; with Workers AI they stay in its free allowance at the default cap.
- A token with `content:publish` given to the agents does not let them publish; it only lets a person mistake their drafts for theirs.

## Alternatives considered

- The Agents SDK. Rejected for the reasons above; a chat with an agent could add it later, in a package of its own.
- Reacting to events instead of a cron. Rejected for now: Hollware's events are publications, and the work of the reviewer starts with a request for review; a few minutes of delay costs nothing here.
- Asking for reviews with `publish` and a token without `content:publish`. Rejected: the guarantee would rest on a token the user configures.
