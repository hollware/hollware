---
'@hollware/server': minor
---

A personal token lists only the MCP tools its scopes allow, so an agent no longer sees tools it cannot call, and its client keeps that list to itself. An OAuth client still lists every tool, so that it can ask for more scopes, and a call without the scope still gets the 403 that names it.
