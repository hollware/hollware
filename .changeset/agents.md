---
'@hollware/agents': minor
'@hollware/core': minor
'@hollware/server': minor
---

`@hollware/agents` (ADR-032): a reviewer that comments once on each pending review, a translator that drafts the missing translation of a published entry, fixes what the contracts refuse and asks for its review, and a weekly auditor that reports old but much-read entries and published entries the contracts refuse now, as a draft and optionally to a webhook such as Slack's. They run on a Worker of their own made by `createHollwareAgents`, reach Hollware over MCP with a personal token, and never publish: their client refuses every tool that publishes or decides. The new tool `request_review` asks for a review after the same checks as `publish` and never publishes, whatever the caller's scopes.
