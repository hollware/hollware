---
'@hollware/core': minor
'@hollware/server': minor
'@hollware/client': minor
---

Agents plug into a site with least privilege: a site declares `agents` that hear its events through a signed webhook or a service binding, each with a grant (`hw_agt_`) of an hour that acts as an agent member and dies with its review; the scopes `review:read` and `review:comment` (implied by `content:read` and `content:write`), `review.requireAgents` with `agents_pending` and an owner's `override` on approve_review, each review's `agents`, `verifyAgentEvent`, `hollwareAgentClient` and `api/agents.json`.
