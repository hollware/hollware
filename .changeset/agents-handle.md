---
'@hollware/agents': minor
---

`createHollwareAgents()` returns `handle(event, grant, env)`: on `review.requested` delivered over a binding, the reviewer reads that review with the event's grant and comments on each entry it proposes; `grantHollware`, `reviewById` and the types `AgentGrant`, `HollwareEvent` and `HollwareAgentRpc` are exported, `get_review` joins the allowlist, and `HOLLWARE_AGENT_TOKEN` is optional (the cron roles skip without it).
